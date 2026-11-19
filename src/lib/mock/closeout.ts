/**
 * Closes out accounts whose equity has fallen below the close-out share of their requirement, as the engine does from V81
 * (`crates/core/src/portfolio/closeout.rs`, monkey-trading/engine#913 D6): close the least that restores the level, keeping each
 * offset group together.
 */

import { absFixed, fixedToWire, type Fixed } from "../fixed";
import type { EngineEvent, MarketId } from "../engine/types";
import { mulRounded } from "../fixed-rounding";
import { discountedBase, profitFee } from "../holding-fee";
import type { TierTerms } from "../volume-tier";
import { tierTable } from "./accounts";
import { closeFeeBps, fillEvents, fillOrder, quoteAtShare } from "./execute";
import { closeoutShare, groupIndexOf, groupMarkets, requirementOf, tradeable } from "./portfolio";
import type { AccountState, MockState } from "./state";
import { cloneBook, recordFill, tierNow } from "./volume";

/** A candidate's score: the change in slack its closes make, the USD notional they close, and its lowest market. */
interface Scored {
  members: MarketId[];
  gain: Fixed;
  notional: Fixed;
  first: MarketId;
}

/** One position's close in a close-out: what it changes the account's equity by, the notional it closes, and its fill's price. */
interface Close {
  change: Fixed;
  notional: Fixed;
  price: Fixed;
}

/**
 * What closing the whole position in `market` changes the account's equity by, at the price a close-out fills at (the index, its
 * spread up to the close-spread ceiling, at the best-price share of the tier `terms`) less the profit fee on a gain at that tier's
 * discount, against the unrealised result it replaces; null when its close does not price.
 */
function closeChange(state: MockState, account: AccountState, market: MarketId, terms: TierTerms | null): Close | null {
  const held = account.positions.get(market);
  const runtime = state.markets.get(market);
  if (held === undefined || runtime === undefined) return null;
  const long = held.qty > 0n;
  const priced = quoteAtShare(state, market, long ? "sell" : "buy", absFixed(held.qty), held.qty, terms?.bestPriceShareBps);
  if (priced === null || priced.kind === "refused") return null;
  // Realised as `Position::apply` rounds it, down, then less its fee, against the unrealised result at the index, also rounded down.
  const realised = mulRounded(long ? priced.price - held.entry : held.entry - priced.price, absFixed(held.qty), "down");
  const feeBps = closeFeeBps(state, account, held, state.now, discountedBase(state.params.profitFeeBps, terms?.feeDiscountBps ?? 0));
  const change = realised - profitFee(realised, feeBps) - mulRounded(held.qty, runtime.mid - held.entry, "down");
  return { change, notional: mulRounded(absFixed(held.qty), runtime.mid, "up"), price: priced.price };
}

/**
 * What closing `members` in market order changes the account's equity by, and the notional they close; null when one does not
 * price. As the engine scores a group from V84 (#1008), each member after the first fills at the volume tier the earlier fills
 * leave, which count a close-out's volume at once: its best-price share and its fee discount (`tier_after_closeouts`). The engine
 * also scores them at the house NAV those fills leave, which only its stress level reads; the mock's stress reads no NAV, so every
 * member fills at its market's level now.
 */
export function scoreMembers(state: MockState, account: AccountState, members: readonly MarketId[]): { change: Fixed; notional: Fixed } | null {
  const table = tierTable(state);
  const book = cloneBook(account.volume);
  let [change, notional] = [0n, 0n];
  for (const market of members) {
    const held = account.positions.get(market)?.qty ?? 0n;
    const close = closeChange(state, account, market, table[tierNow(book, table, state.now)] ?? null);
    if (close === null) return null;
    [change, notional] = [change + close.change, notional + close.notional];
    recordFill(book, { market, held, delta: -held, price: close.price, now: state.now, liquidation: true });
  }
  return { change, notional };
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
function nextStep(state: MockState, account: AccountState): { members: MarketId[]; equity: Fixed; requirement: Fixed } | null {
  const { equity, requirement } = requirementOf(state, account, { kind: "market" });
  const threshold = closeoutShare(state, requirement);
  if (account.positions.size === 0 || requirement === 0n || equity >= threshold) return null;
  const slack = equity - threshold;
  // A position may close when its market trades and its close prices at the tier the account trades at now.
  const closable = new Set([...account.positions.keys()].filter((id) => tradeable(state, id) && scoreMembers(state, account, [id]) !== null));
  const scored: Scored[] = candidates(state, account, closable).flatMap((members) => {
    const closes = scoreMembers(state, account, members);
    if (closes === null) return [];
    const after = requirementOf(state, account, { kind: "market" }, members).requirement;
    return [{ members, gain: closes.change + threshold - closeoutShare(state, after), notional: closes.notional, first: members[0] ?? 0 }];
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
  for (let step = nextStep(state, account); step !== null; step = nextStep(state, account)) {
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
