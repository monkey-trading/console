/**
 * The mock node's portfolio requirement under its offset grid (`state.params.portfolioGrid`), as the engine's V81 and V84
 * value it (`crates/core/src/portfolio/requirement.rs`): the per-position requirement at a basis's bands less each group's
 * credit (`portfolio-credit.ts`), on the mock's USD markets at their index.
 */

import { absFixed, fixedFromWire, fixedToWire, type Fixed } from "../fixed";
import { mulRounded } from "../fixed-rounding";
import { metaFor } from "../engine/meta";
import type { PortfolioMarginWire } from "../engine/portfolio-types";
import type { MarketId } from "../engine/types";
import { closeoutShareOf, groupCredit, type CreditLeg, type GroupCredit } from "../portfolio-credit";
import { tieredMargin } from "../pricing";
import { flooredMargin } from "../volume-tier";
import type { Holding, MockState } from "./state";

/**
 * The bands a requirement takes: the market's, which close-outs read; or initial, each band at least the account's tier floor,
 * with no credit for a group while a member the account holds cannot trade unless `shutCredited`, which V84's check of a
 * reducing fill keeps (`Basis::Initial`).
 */
export type Basis = { kind: "market" } | { kind: "initial"; floorBps: number; shutCredited: boolean };

/** What a requirement reads of an account: its cash and its positions. */
export interface Book {
  balance: Fixed;
  positions: ReadonlyMap<MarketId, Holding>;
}

/** An offset group of the grid, its loadings decoded. */
interface Group {
  name: string;
  floorShareBps: number;
  members: { market: MarketId; loading: Fixed; residualShockBps: number }[];
}

/** A requirement and the equity beside it, with the per-position requirement it is taken from. */
export interface Requirement {
  equity: Fixed;
  perPosition: Fixed;
  requirement: Fixed;
}

/** The grid's groups; none while the parameters name no grid. */
function groupsOf(state: MockState): Group[] {
  return (state.params.portfolioGrid?.groups ?? []).map((group) => ({
    name: group.name, floorShareBps: group.floor_share_bps,
    members: group.members.map((member) => ({ market: member.market, loading: fixedFromWire(member.loading), residualShockBps: member.residual_shock_bps })),
  }));
}

/** Whether a market can trade now: open and not halted. The mock's index is always fresh, so an open market is always priced. */
export function tradeable(state: MockState, market: MarketId): boolean {
  const runtime = state.markets.get(market);
  return runtime !== undefined && runtime.open && !runtime.halted;
}

/** The index of the grid's group holding `market`, or null for an ungrouped market. */
export function groupIndexOf(state: MockState, market: MarketId): number | null {
  const found = groupsOf(state).findIndex((group) => group.members.some((member) => member.market === market));
  return found < 0 ? null : found;
}

/** The markets of the grid's group `index`, in the grid's order. */
export function groupMarkets(state: MockState, index: number): MarketId[] {
  return groupsOf(state)[index]?.members.map((member) => member.market) ?? [];
}

/** A grouped position as the requirement values it: its leg's inputs, keyed by market. */
type Valued = Map<MarketId, { qty: Fixed; price: Fixed; notional: Fixed; band: Fixed }>;

/**
 * `book`'s equity and requirement at `basis`, each position but those in `without` valued at `priceOf`'s price (its market's
 * index by default): the mock's per-position bands (at the market's bands, as its `marginOf`; at initial bands, each at least the
 * tier floor, as its `initialMarginOf`) less each group's credit, its legs' close-out cost at the market's close-spread ceiling.
 */
export function requirementOf(state: MockState, book: Book, basis: Basis, without: readonly MarketId[] = [], priceOf?: (market: MarketId) => Fixed): Requirement {
  const { equity, perPosition, valued } = valueBook(state, book, basis, without, priceOf);
  const credit = groupsOf(state).reduce((sum, group) => sum + (creditOf(state, group, basis, valued)?.offset ?? 0n), 0n);
  return { equity, perPosition, requirement: perPosition - credit };
}

/** `book`'s equity, its per-position requirement at `basis` and each position as valued, as `requirementOf` takes them. */
function valueBook(state: MockState, book: Book, basis: Basis, without: readonly MarketId[], priceOf?: (market: MarketId) => Fixed): { equity: Fixed; perPosition: Fixed; valued: Valued } {
  let equity = book.balance;
  let perPosition = 0n;
  const valued: Valued = new Map();
  for (const [id, held] of book.positions) {
    const runtime = state.markets.get(id);
    if (runtime === undefined || without.includes(id)) continue;
    const price = priceOf?.(id) ?? runtime.mid;
    // As the engine values a position for margin (`valued_positions`): its notional rounded up, its profit or loss rounded down.
    const notional = mulRounded(absFixed(held.qty), price, "up");
    const tiers = runtime.listed.spec.margin_tiers;
    const band = basis.kind === "market" ? tieredMargin(tiers, notional) : flooredMargin(tiers, notional, basis.floorBps);
    equity += mulRounded(held.qty, price - held.entry, "down");
    perPosition += band;
    valued.set(id, { qty: held.qty, price, notional, band });
  }
  return { equity, perPosition, valued };
}

/** `group`'s standing from the valued positions, or null when they hold none of its members, or at initial bands while one cannot trade (`group_exposure`). */
function creditOf(state: MockState, group: Group, basis: Basis, valued: Valued): GroupCredit | null {
  const held = group.members.flatMap((member) => {
    const position = valued.get(member.market);
    return position === undefined ? [] : [{ member, position }];
  });
  if (held.length === 0) return null;
  if (basis.kind === "initial" && !basis.shutCredited && held.some(({ member }) => !tradeable(state, member.market))) return null;
  const legs: CreditLeg[] = held.map(({ member, position }) => ({
    qty: position.qty, price: position.price, loading: member.loading, bands: position.band, notional: position.notional,
    residualShockBps: member.residualShockBps, ceilingBps: closeCeiling(state, member.market),
  }));
  return groupCredit(legs, group.floorShareBps, state.params.closeoutLevelBps);
}

/** The market's close-spread ceiling in bps, the cost of closing a leg the grid charges; none adds no cost. */
function closeCeiling(state: MockState, market: MarketId): number {
  const symbol = state.markets.get(market)?.listed.spec.symbol;
  return symbol === undefined ? 0 : (metaFor(symbol).closeCeilingBps ?? 0);
}

/**
 * The account read's `portfolio_margin` while the grid names a group, else undefined: the requirement at the market's bands, at
 * initial bands (`floorBps` the tier floor) and at the close-out level, with each group the account holds a member of at the
 * market's bands (`portfolio_standing`, `group_standing`).
 */
export function portfolioStanding(state: MockState, book: Book, floorBps: number): PortfolioMarginWire | undefined {
  const groups = groupsOf(state);
  if (groups.length === 0) return undefined;
  const market = requirementOf(state, book, { kind: "market" });
  const initial = requirementOf(state, book, { kind: "initial", floorBps, shutCredited: false });
  const { valued } = valueBook(state, book, { kind: "market" }, []);
  const standing: PortfolioMarginWire["groups"] = {};
  for (const group of groups) {
    const credit = creditOf(state, group, { kind: "market" }, valued);
    if (credit === null) continue;
    standing[group.name] = {
      members: group.members.map((member) => member.market).filter((id) => valued.has(id)),
      net_notional: fixedToWire(credit.netNotional), matched_notional: fixedToWire(credit.matchedNotional), worst_loss: fixedToWire(credit.worstLoss),
      binding_direction: credit.bindingDirection, offset: fixedToWire(credit.offset),
    };
  }
  return {
    margin: fixedToWire(market.requirement), initial_margin: fixedToWire(initial.requirement),
    maintenance_margin: fixedToWire(closeoutShare(state, market.requirement)), groups: standing,
  };
}

/** The close-out level's share of a requirement, rounded up as the engine's charges are: the maintenance requirement and the close-out threshold. */
export function closeoutShare(state: MockState, requirement: Fixed): Fixed {
  return closeoutShareOf(requirement, state.params.closeoutLevelBps);
}

/**
 * Whether `book` holds `market`'s group on both sides, so that the position's requirement follows its price through the group's
 * credit (`Engine::portfolio_move`): a group held on one side matches nothing at any price.
 */
export function heldOnBothSides(state: MockState, book: Book, market: MarketId): boolean {
  const index = groupIndexOf(state, market);
  const group = index === null ? undefined : groupsOf(state)[index];
  if (group === undefined) return false;
  const sides = group.members.flatMap((member) => {
    const held = book.positions.get(member.market);
    return held === undefined || held.qty === 0n ? [] : [(held.qty < 0n) !== (member.loading < 0n)];
  });
  return sides.includes(true) && sides.includes(false);
}
