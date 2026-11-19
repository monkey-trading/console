/**
 * Closes out accounts whose equity has fallen below the close-out share of their requirement, as the engine does from V81
 * (`crates/core/src/portfolio/closeout.rs`, monkey-trading/engine#913 D6): close the least that restores the level, keeping each
 * offset group together.
 */

import { absFixed, fixedToWire, mulFixed, type Fixed } from "../fixed";
import type { EngineEvent, MarketId } from "../engine/types";
import { mulRounded } from "../fixed-rounding";
import { profitFee } from "../holding-fee";
import { closeFeeBps, fillEvents, fillOrder, liveQuote } from "./execute";
import { closeoutShare, groupIndexOf, groupMarkets, requirementOf, tradeable } from "./portfolio";
import type { AccountState, MockState } from "./state";

/** A candidate's score: the change in slack its closes make, the USD notional they close, and its lowest market. */
interface Scored {
  members: MarketId[];
  gain: Fixed;
  notional: Fixed;
  first: MarketId;
}

/**
 * What closing the whole position in `market` changes the account's equity by, at the price a close-out fills at (the index, its
 * spread up to the close-spread ceiling) less the profit fee on a gain, and the notional it closes; null when its close does not
 * price. The mock scores every close at the stress level and tier it trades at now, where the engine scores a group's later
 * members at the house NAV and the tier its earlier fills leave.
 */
function closeChange(state: MockState, address: string, account: AccountState, market: MarketId): { change: Fixed; notional: Fixed } | null {
  const held = account.positions.get(market);
  const runtime = state.markets.get(market);
  if (held === undefined || runtime === undefined) return null;
  const long = held.qty > 0n;
  const priced = liveQuote(state, address, market, long ? "sell" : "buy", absFixed(held.qty));
  if (priced === null || priced.kind === "refused") return null;
  // Realised as `Position::apply` rounds it, down, then less its fee, against the unrealised result at the index it replaces.
  const realised = mulRounded(long ? priced.price - held.entry : held.entry - priced.price, absFixed(held.qty), "down");
  const change = realised - profitFee(realised, closeFeeBps(state, account, held, state.now)) - mulFixed(held.qty, runtime.mid - held.entry);
  return { change, notional: absFixed(mulFixed(held.qty, runtime.mid)) };
}

/**
 * The candidates, each the markets it closes in market order: each ungrouped position that may close, each group whose held
 * members may all close, whole, and each member that may close of a group with one that may not, alone (`candidates`).
 */
function candidates(state: MockState, account: AccountState, closable: ReadonlySet<MarketId>): MarketId[][] {
  const seen = new Set<number>();
  const found: MarketId[][] = [];
  for (const id of [...account.positions.keys()].sort((a, b) => a - b)) {
    const group = groupIndexOf(state, id);
    if (group === null) {
      if (closable.has(id)) found.push([id]);
      continue;
    }
    if (seen.has(group)) continue;
    seen.add(group);
    const held = groupMarkets(state, group).filter((market) => account.positions.has(market)).sort((a, b) => a - b);
    if (held.every((market) => closable.has(market))) found.push(held);
    else found.push(...held.filter((market) => closable.has(market)).map((market) => [market]));
  }
  return found;
}

/**
 * Whether `a` is preferred to `b`: among candidates that restore the level, the one closing the least notional; a restoring one
 * over one that does not; otherwise the greater gain per dollar closed, compared by cross-multiplying; then the lower market id.
 */
function preferred(a: Scored, b: Scored, restores: (scored: Scored) => boolean): boolean {
  const cmp = (x: bigint, y: bigint): number => (x > y ? 1 : x < y ? -1 : 0);
  const [ra, rb] = [restores(a), restores(b)];
  const order = ra && rb ? cmp(b.notional, a.notional) : ra !== rb ? (ra ? 1 : -1) : cmp(a.gain * b.notional, b.gain * a.notional);
  return order > 0 || (order === 0 && a.first < b.first);
}

/** The positions the account closes next, with its equity and requirement, or null when it meets the level or nothing it holds may close (`next_portfolio_step`). */
function nextStep(state: MockState, address: string, account: AccountState): { members: MarketId[]; equity: Fixed; requirement: Fixed } | null {
  const { equity, requirement } = requirementOf(state, account, { kind: "market" });
  const threshold = closeoutShare(state, requirement);
  if (account.positions.size === 0 || requirement === 0n || equity >= threshold) return null;
  const slack = equity - threshold;
  const closes = new Map<MarketId, { change: Fixed; notional: Fixed }>();
  for (const id of account.positions.keys()) {
    const close = tradeable(state, id) ? closeChange(state, address, account, id) : null;
    if (close !== null) closes.set(id, close);
  }
  const scored: Scored[] = candidates(state, account, new Set(closes.keys())).map((members) => {
    const after = requirementOf(state, account, { kind: "market" }, members).requirement;
    const gain = members.reduce((sum, id) => sum + (closes.get(id)?.change ?? 0n), 0n) + threshold - closeoutShare(state, after);
    const notional = members.reduce((sum, id) => sum + (closes.get(id)?.notional ?? 0n), 0n);
    return { members, gain, notional, first: members[0] ?? 0 };
  });
  const restores = (candidate: Scored) => slack + candidate.gain >= 0n;
  const best = scored.reduce<Scored | null>((kept, next) => (kept === null || preferred(next, kept, restores) ? next : kept), null);
  return best === null ? null : { members: best.members, equity, requirement };
}

/**
 * Closes `address` out step by step until it meets the level or nothing it holds may close: each step's positions close whole in
 * market order, and a fill that fails ends the account's close-out. The close-out is announced with its first step.
 */
export function closeOutAccount(state: MockState, address: string): EngineEvent[] {
  const account = state.account(address);
  const events: EngineEvent[] = [];
  for (let step = nextStep(state, address, account); step !== null; step = nextStep(state, address, account)) {
    if (events.length === 0) events.push({ type: "close_out", account: address, equity: fixedToWire(step.equity), margin: fixedToWire(step.requirement) });
    for (const market of step.members) {
      const held = account.positions.get(market);
      if (held === undefined) continue;
      const outcome = fillOrder(state, { address, market, side: held.qty > 0n ? "sell" : "buy", qty: absFixed(held.qty), reduceOnly: true, orderId: 0, liquidation: true, cause: "close_out" });
      if (!outcome.ok) return events;
      events.push(...fillEvents(outcome));
    }
  }
  return events;
}

/** Closes out every account below its level; positions in a market that cannot trade wait. */
export function closeOutUnderwater(state: MockState): EngineEvent[] {
  return [...state.accounts.keys()].flatMap((address) => closeOutAccount(state, address));
}

/**
 * From V81, while a grid applies, the check once a command's fills are done: an account with a fill other than a close-out's
 * is closed out if they left it below its level, as closing one leg can through the spread and the fee (`check_filled_accounts`).
 */
export function checkFilled(state: MockState, address: string, events: readonly EngineEvent[]): EngineEvent[] {
  const filled = events.some((event) => event.type === "fill" && !event.liquidation && event.account.toLowerCase() === address.toLowerCase());
  return filled && state.params.portfolioGrid !== undefined ? closeOutAccount(state, address) : [];
}
