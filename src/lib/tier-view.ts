/**
 * What the console shows of an account's volume tier: the account panel's standing (tier, volume, the
 * step to the next tier and what each brings) and the ticket's limits in the selected market (best-price
 * size, leverage, resting orders). All of it is the node's: the account read for the account's own
 * figures, the house parameters' tier table for what a tier brings.
 */

import type { MarketId, MarketView, SpreadTier } from "./engine/types";
import { formatFixedPlaces, type Fixed } from "./fixed";
import type { HouseParams } from "./house";
import type { AccountModel } from "./models";
import { accountSpreadTiers, benefitsOf, decodeTiers, formatLeverage, nextTier, type Benefits, type NextTier, type TierTerms, type VolumeModel } from "./volume-tier";

/** The account panel's view of the account's tier. */
export interface TierStanding {
  tier: number;
  volume: VolumeModel;
  /** The table, when the parameters read name one: what each tier needs and brings. Null while they are unread or name none. */
  table: TierTerms[] | null;
  /** The step to the next tier; null at the top, and while the table is unread. */
  next: NextTier | null;
}

/** The account's tier standing, or null from a node that predates volume tiers. */
export function tierStanding(account: AccountModel | null, params: HouseParams | null): TierStanding | null {
  const volume = account?.volume;
  if (volume === undefined) return null;
  const table = params === null ? null : decodeTiers(params.volumeTiers ?? []);
  // A table that does not reach the account's tier is not the one its read was taken under: show the figures but no terms.
  const usable = table !== null && table[volume.tier] !== undefined ? table : null;
  return { tier: volume.tier, volume, table: usable, next: usable === null ? null : nextTier(volume, usable) };
}

/** What the account's tier brings in a market, and what the next tier would. */
export function tierBenefits(standing: TierStanding, market: MarketView | undefined): { now: Benefits; next: Benefits | null } | null {
  const { table } = standing;
  const current = table?.[standing.tier];
  if (table === null || current === undefined) return null;
  const upcoming = table[standing.tier + 1];
  return { now: benefitsOf(current, market), next: upcoming === undefined ? null : benefitsOf(upcoming, market) };
}

/** A USD amount of notional with no cents: `$250,000`. */
export function usdWhole(value: Fixed): string {
  return `$${formatFixedPlaces(value, 0)}`;
}

/** What the ticket shows of the account's limits in the selected market. */
export interface TicketLimits {
  tier: number;
  /** The notional, in USD, up to which the account pays the market's first band; null for a market with one band. */
  bestPriceBound: Fixed | null;
  /** The most leverage a position here can take; null before V64. */
  leverage: Fixed | null;
  /** The resting orders the tier allows and the account rests now; the limit is null where the tier names none. */
  orderLimit: number | null;
  resting: number;
}

/** The limits the account's read gives for `market`, or null from a node that predates volume tiers. */
export function ticketLimits(account: AccountModel | null, market: MarketId): TicketLimits | null {
  const volume = account?.volume;
  if (account === null || volume === undefined) return null;
  return {
    tier: volume.tier, bestPriceBound: volume.bestPriceBounds.get(market) ?? null, leverage: account.requirements?.maxLeverage.get(market) ?? null,
    orderLimit: volume.maxRestingOrders, resting: account.orders.length,
  };
}

/** The reason a limit or stop order is stopped at the ticket: the account already rests its tier's most. Null for a market order or while there is room. */
export function orderLimitProblem(limits: TicketLimits | null, resting: boolean): string | null {
  if (limits === null || !resting || limits.orderLimit === null || limits.resting < limits.orderLimit) return null;
  return `You rest ${limits.resting} orders, the most at volume tier ${limits.tier}. Cancel one to place another, or trade up a tier for a higher limit.`;
}

/** Why the leverage limit applies, for a size the node declines for margin: the tier's limit, named. */
export function leverageReason(limits: TicketLimits | null): string {
  return limits === null || limits.leverage === null ? "" : ` Volume tier ${limits.tier} allows up to ${formatLeverage(limits.leverage)} here.`;
}

/**
 * What the account's tier changes in the console's own pricing of an order in `view`'s market: the
 * margin floor of its initial requirement (V64) and its first spread band's end (V59). Empty while the
 * parameters' table is unread, as the node's quotes then stand for the console's.
 */
export function accountPricing(account: AccountModel | null, params: HouseParams | null, view: MarketView): { marginFloorBps?: number; spreadTiers?: SpreadTier[] } {
  const standing = tierStanding(account, params);
  const terms = standing?.table?.[standing.tier];
  return terms === undefined ? {} : { marginFloorBps: terms.marginFloorBps, spreadTiers: accountSpreadTiers(view.spread_tiers, terms.bestPriceShareBps) };
}

/** The step to the next tier in words: the counted volume left, how many days a day's cap makes of it, and the fewest more days that can cover it. */
export function describeNextTier(next: NextTier): string {
  const days = next.daysLeast === 1 ? "one more day" : `${next.daysLeast} more days`;
  if (next.volumeLeft === 0n) return `Tier ${next.tier} needs trading on at least ${next.daysNeeded} days, each counting up to ${usdWhole(next.dayCap)}.`;
  return `Tier ${next.tier} needs ${usdWhole(next.volumeLeft)} more counted volume, over at least ${days} at the day cap of ${usdWhole(next.dayCap)} (${next.daysNeeded} days in all).`;
}

/** A best-price bound as the panel states it: the notional a market's first band covers, or that the market has one band. */
export function describeBestPrice(bound: Fixed | null): string {
  return bound === null ? "Whole size" : `Up to ${usdWhole(bound)}`;
}

/** The order limit and request rate as the panel states them; a limit the tier does not name is the node's own. */
export function describeLimit(value: number | null): string {
  return value === null ? "Node's default" : String(value);
}
