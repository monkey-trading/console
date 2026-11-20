/**
 * Portfolio margin as the console reads it (monkey-trading/engine#913): the account read's portfolio requirement and offset
 * groups (V81), and which of them earn a credit. Detail is shown only for a group whose positions offset each other and earn
 * one, so an account that earns none sees the console as it would without portfolio margin.
 */

import type { MarketId } from "./engine/types";
import type { OffsetGroupGridWire, PortfolioGridWire, PortfolioMarginWire } from "./engine/portfolio-types";
import { parseFixed, type Fixed } from "./fixed";
import { mulRounded } from "./fixed-rounding";
import { groupCredit, type CreditLeg } from "./portfolio-credit";
import type { Tier } from "./engine/types";
import { flooredMargin } from "./volume-tier";

/** One offset group the account holds a member of, at the market's bands. */
export interface OffsetGroupModel {
  /** The grid's name for the group, which keys it; never shown. */
  name: string;
  /** The group's markets the account holds, in the grid's order. */
  members: MarketId[];
  /** The loading-weighted net notional, in USD: positive long, negative short. */
  netNotional: Fixed;
  /** The exposure that offsets other exposure in the group, in USD. */
  matchedNotional: Fixed;
  /** What the group takes off the per-position requirement, in USD. */
  offset: Fixed;
}

/** The account's portfolio requirement: at the market's bands, at initial bands (what new risk and withdrawals meet) and at the close-out level. */
export interface PortfolioModel {
  margin: Fixed;
  initialMargin: Fixed;
  maintenanceMargin: Fixed;
  groups: OffsetGroupModel[];
}

/** The read's `portfolio_margin`, or undefined when absent (no grid, or a node that predates V81) or malformed. */
export function decodePortfolio(wire: PortfolioMarginWire | undefined): PortfolioModel | undefined {
  if (wire === undefined) return undefined;
  const [margin, initialMargin, maintenanceMargin] = [wire.margin, wire.initial_margin, wire.maintenance_margin].map(parseFixed);
  if (margin == null || initialMargin == null || maintenanceMargin == null) return undefined;
  const groups: OffsetGroupModel[] = [];
  for (const [name, group] of Object.entries(wire.groups)) {
    const [netNotional, matchedNotional, offset] = [group.net_notional, group.matched_notional, group.offset].map(parseFixed);
    if (netNotional == null || matchedNotional == null || offset == null || !group.members.every(Number.isSafeInteger)) return undefined;
    groups.push({ name, members: [...group.members], netNotional, matchedNotional, offset });
  }
  return { margin, initialMargin, maintenanceMargin, groups };
}

/** The groups whose positions offset each other and earn a credit, the only ones the console shows. */
export function creditedGroups(portfolio: PortfolioModel | undefined): OffsetGroupModel[] {
  return portfolio?.groups.filter((group) => group.offset > 0n) ?? [];
}

/** The sum of every group's credit, which the account's requirement is below its per-position margin by. */
export function totalOffset(portfolio: PortfolioModel | undefined): Fixed {
  return creditedGroups(portfolio).reduce((sum, group) => sum + group.offset, 0n);
}

/** The credited group `market` is held in, or null when it is in none. */
export function creditedGroupOf(portfolio: PortfolioModel | undefined, market: MarketId): OffsetGroupModel | null {
  return creditedGroups(portfolio).find((group) => group.members.includes(market)) ?? null;
}

/** The grid's group `market` is a member of, or null when it is in none or the grid is not read. */
export function gridGroupOf(grid: PortfolioGridWire | undefined, market: MarketId): OffsetGroupGridWire | null {
  return grid?.groups.find((group) => group.members.some((member) => member.market === market)) ?? null;
}

/**
 * A group's matched exposure, twice its smaller side's loading-weighted exposure (`crates/core/src/portfolio/exposure.rs`), at
 * the scale of three `Fixed` factors: each held member's quantity from `qtyOf`, its mark from `markOf` and its loading. Null
 * when a held member has no mark or a loading does not parse, so it cannot be told.
 */
function matchedExposure(group: OffsetGroupGridWire, qtyOf: (market: MarketId) => Fixed, markOf: (market: MarketId) => Fixed | null): bigint | null {
  let [long, short] = [0n, 0n];
  for (const member of group.members) {
    const qty = qtyOf(member.market);
    if (qty === 0n) continue;
    const [mark, loading] = [markOf(member.market), parseFixed(member.loading)];
    if (mark === null || loading === null) return null;
    const exposure = qty * mark * loading;
    if (exposure > 0n) long += exposure;
    else short -= exposure;
  }
  return 2n * (long < short ? long : short);
}

/**
 * What the console reads to tell whether a group could earn a credit: the close-out level, and each market's margin bands with
 * the floor its initial bands carry now (the account's tier floor or an applying weekend margin), null while either is unread.
 */
export interface CreditTerms {
  levelBps: number;
  bandsOf: (market: MarketId) => { tiers: readonly Tier[]; initialFloorBps: number } | null;
}

/**
 * Whether `group`, held as `qtyOf` says, could earn a credit at the market's bands or at initial bands. Each leg is charged for
 * its residual shock only, since the node serves no close-spread ceiling: that charge is never above the engine's, so a group
 * this finds no credit for earns none, and one it cannot value (a missing mark, loading or bands) is taken to earn one.
 */
function couldEarnCredit(group: OffsetGroupGridWire, qtyOf: (market: MarketId) => Fixed, markOf: (market: MarketId) => Fixed | null, terms: CreditTerms): boolean {
  const held = group.members.filter((member) => qtyOf(member.market) !== 0n);
  const inputs = held.map((member) => ({ member, mark: markOf(member.market), loading: parseFixed(member.loading), bands: terms.bandsOf(member.market) }));
  const legsAt = (initial: boolean): CreditLeg[] | null => {
    const legs: CreditLeg[] = [];
    for (const { member, mark, loading, bands } of inputs) {
      if (mark === null || loading === null || bands === null) return null;
      const qty = qtyOf(member.market);
      const notional = mulRounded(qty < 0n ? -qty : qty, mark < 0n ? -mark : mark, "up");
      legs.push({ qty, price: mark, loading, bands: flooredMargin(bands.tiers, notional, initial ? bands.initialFloorBps : 0), notional, residualShockBps: member.residual_shock_bps, ceilingBps: 0 });
    }
    return legs;
  };
  return [false, true].some((initial) => {
    const legs = legsAt(initial);
    return legs === null || groupCredit(legs, group.floor_share_bps, terms.levelBps).offset > 0n;
  });
}

/**
 * Whether an order that moves the account's position in `market` by `delta` concerns portfolio margin, so the ticket asks the
 * server what it would do: the account earns a credit in the market's group, or the order would create one, change one or
 * remove one, its group's matched exposure at the marks moving. An order in no group's markets, one that matches nothing
 * before or after, and, given `terms`, one whose group earns no credit afterwards, at either basis, does not.
 */
export function touchesOffset(input: {
  portfolio: PortfolioModel | undefined;
  grid: PortfolioGridWire | undefined;
  positions: readonly { market: MarketId; qty: Fixed }[];
  markOf: (market: MarketId) => Fixed | null;
  market: MarketId;
  delta: Fixed;
  terms?: CreditTerms;
}): boolean {
  if (creditedGroupOf(input.portfolio, input.market) !== null) return true;
  const group = gridGroupOf(input.grid, input.market);
  // A group whose floor share keeps all of its matched exposure's margin gives no credit.
  if (group === null || input.delta === 0n || group.floor_share_bps >= 10_000) return false;
  const held = (market: MarketId) => input.positions.find((p) => p.market === market)?.qty ?? 0n;
  const after = (market: MarketId) => held(market) + (market === input.market ? input.delta : 0n);
  const [matchedBefore, matchedAfter] = [matchedExposure(group, held, input.markOf), matchedExposure(group, after, input.markOf)];
  if (matchedBefore === null || matchedAfter === null || matchedBefore === matchedAfter) return false;
  return input.terms === undefined || couldEarnCredit(group, after, input.markOf, input.terms);
}
