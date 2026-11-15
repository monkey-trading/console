/**
 * Volume tiers as the engine holds them (`engine_core::volume_tier`, from V59): what an account's
 * read says about its tier, what each tier brings, and the gap to the next. The tier table comes from
 * the house parameters, the account's standing from its read; the figures that depend on a market
 * (the best-price bound, the leverage) are worked out from that market's bands as the engine does.
 */

import type { MarketId, SpreadTier, Tier } from "./engine/types";
import type { VolumeStandingWire, VolumeTierWire } from "./engine/volume-types";
import { fixedFromInt, fixedFromWire, fixedToWire, minFixed, parseFixed, ZERO, type Fixed } from "./fixed";
import { divRounded, mulBpsRounded } from "./fixed-rounding";

/** One tier of the table: what reaches it and what it brings. A limit or rate the table does not name is null. */
export interface TierTerms {
  /** The counted volume over the window, in USD, that reaches the tier. */
  threshold: Fixed;
  /** A day counts at most `threshold / dayDivisor`, so the tier takes trading on at least this many days. */
  dayDivisor: number;
  /** Where the first spread band ends, in bps of a market's first bound. */
  bestPriceShareBps: number;
  /** The least rate each margin band charges in the initial requirement, in bps; zero charges nothing beyond the market's own. */
  marginFloorBps: number;
  maxRestingOrders: number | null;
  requestsPerSecond: number | null;
}

/** How far an account is towards one tier. */
export interface TierProgress {
  /** The counted volume the tier's day cap admits, which reaches the tier at its threshold. */
  capped: Fixed;
  /** The days of the window at the tier's day cap. */
  days: number;
}

/** An account's volume as its read gives it. */
export interface VolumeModel {
  tier: number;
  /** The volume counted over the window, in USD. */
  matured: Fixed;
  /** The notional waiting to count, in USD. */
  pending: Fixed;
  progress: TierProgress[];
  /** Where each market's first band ends for the account, in USD; a market with one band is absent. */
  bestPriceBounds: ReadonlyMap<MarketId, Fixed>;
  maxRestingOrders: number | null;
  requestsPerSecond: number | null;
}

const whole = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** The table the house parameters name, or null when any tier is malformed (a table is all or nothing). */
export function decodeTiers(wire: readonly VolumeTierWire[]): TierTerms[] | null {
  const tiers: TierTerms[] = [];
  for (const tier of wire) {
    const threshold = parseFixed(tier.threshold);
    if (threshold === null || !whole(tier.day_divisor) || tier.day_divisor < 1 || !whole(tier.best_price_share_bps)) return null;
    tiers.push({
      threshold, dayDivisor: tier.day_divisor, bestPriceShareBps: tier.best_price_share_bps, marginFloorBps: whole(tier.margin_floor_bps) ? tier.margin_floor_bps : 0,
      maxRestingOrders: whole(tier.max_resting_orders) && tier.max_resting_orders > 0 ? tier.max_resting_orders : null,
      requestsPerSecond: whole(tier.requests_per_second) && tier.requests_per_second > 0 ? tier.requests_per_second : null,
    });
  }
  return tiers.length === 0 ? null : tiers;
}

/** The account's volume from its read, or null when the read is absent (before V59) or malformed. */
export function decodeVolume(wire: VolumeStandingWire | undefined): VolumeModel | null {
  if (wire === undefined || !whole(wire.tier) || !Array.isArray(wire.progress)) return null;
  const matured = parseFixed(wire.matured);
  const pending = parseFixed(wire.pending);
  if (matured === null || pending === null) return null;
  const progress: TierProgress[] = [];
  for (const p of wire.progress) {
    const capped = parseFixed(p.capped);
    if (capped === null || !whole(p.days)) return null;
    progress.push({ capped, days: p.days });
  }
  const bounds = new Map<MarketId, Fixed>();
  for (const [market, bound] of Object.entries(wire.best_price_bounds ?? {})) {
    const value = parseFixed(bound);
    if (value === null || !Number.isSafeInteger(Number(market))) return null;
    bounds.set(Number(market), value);
  }
  return {
    tier: wire.tier, matured, pending, progress, bestPriceBounds: bounds,
    maxRestingOrders: whole(wire.max_resting_orders) ? wire.max_resting_orders : null, requestsPerSecond: whole(wire.requests_per_second) ? wire.requests_per_second : null,
  };
}

/**
 * Where a market's first spread band ends for an account whose tier takes `shareBps` of it
 * (`AccountBands::new`): that share of the listed bound, rounded down, and at most the second band's
 * bound. Null for a market with one band, whose size has no best price to bound.
 */
export function bestPriceBound(tiers: readonly SpreadTier[], shareBps: number): Fixed | null {
  const [first, second] = tiers;
  if (first === undefined || second === undefined || first.up_to === null) return null;
  const scaled = (fixedFromWire(first.up_to) * BigInt(shareBps)) / 10_000n;
  return second.up_to === null ? scaled : minFixed(scaled, fixedFromWire(second.up_to));
}

/** `tiers` as an account at `shareBps` pays them: the first band ends at its best-price bound, the rest as listed. */
export function accountSpreadTiers(tiers: readonly SpreadTier[], shareBps: number): SpreadTier[] {
  const bound = bestPriceBound(tiers, shareBps);
  const [first, ...rest] = tiers;
  if (bound === null || first === undefined) return [...tiers];
  return [{ ...first, up_to: fixedToWire(bound) }, ...rest];
}

/**
 * The most leverage a position can take in a market whose margin bands each charge at least
 * `floorBps` (`MarketSpec::max_leverage`), rounded down: the market's leverage at its last band's rate,
 * or at a band's end where the average rate up to it is lowest.
 */
export function maxLeverage(margin: readonly Tier[], floorBps: number): Fixed {
  const last = margin[margin.length - 1];
  if (last === undefined) return ZERO;
  const floored = margin.map((tier) => ({ ...tier, bps: Math.max(tier.bps, floorBps) }));
  const limit = divRounded(fixedFromInt(10_000), fixedFromInt(floored[floored.length - 1]?.bps ?? 1), "down");
  let best = limit;
  for (const tier of margin) {
    if (tier.up_to === null) continue;
    const end = fixedFromWire(tier.up_to);
    const required = roundedUpCost(floored, end);
    if (required > ZERO) best = best > divRounded(end, required, "down") ? best : divRounded(end, required, "down");
  }
  return best;
}

/** The margin `tiers` charge on `notional`, each band's charge rounded up, as the engine's requirement rounds. */
function roundedUpCost(tiers: readonly Tier[], notional: Fixed): Fixed {
  let lower = ZERO;
  let charged = ZERO;
  for (const tier of tiers) {
    const upTo = tier.up_to === null ? null : fixedFromWire(tier.up_to);
    const top = upTo === null || upTo > notional ? notional : upTo;
    if (top > lower) charged += mulBpsRounded(top - lower, tier.bps, "up");
    if (upTo === null || upTo >= notional) break;
    lower = upTo;
  }
  return charged;
}

/** The least rate each margin band charges in a market now because of its weekend margin: its rate from two hours before the gap until the reopen (`weekend_margin_applies`), else zero. */
export function weekendFloorBps(window: { weekend_margin_bps: number; from: number; reopen: number } | undefined, now: number): number {
  return window !== undefined && window.from <= now && now < window.reopen ? window.weekend_margin_bps : 0;
}

/** A leverage as the page names it: whole times, `20x`, `100x`. */
export function formatLeverage(leverage: Fixed): string {
  return `${leverage / 1_000_000_000n}x`;
}

/** What it takes to reach the next tier. */
export interface NextTier {
  tier: number;
  /** The counted volume still needed, in USD, at the day cap. */
  volumeLeft: Fixed;
  /** The most one day counts towards it, in USD, rounded down. */
  dayCap: Fixed;
  /** The days at the cap it needs in all, and the fewest more days that can still reach it if each counts its cap. */
  daysNeeded: number;
  daysLeast: number;
}

/** The step from the account's tier to the next, or null at the top of the table or while the table and the account's progress disagree. */
export function nextTier(volume: VolumeModel, table: readonly TierTerms[]): NextTier | null {
  const target = table[volume.tier + 1];
  const progress = volume.progress[volume.tier + 1];
  if (target === undefined || progress === undefined) return null;
  const volumeLeft = target.threshold > progress.capped ? target.threshold - progress.capped : ZERO;
  const dayCap = target.threshold / BigInt(target.dayDivisor);
  // A day counts at most threshold / divisor, so the fewest days that cover the gap is ceil(gap * divisor / threshold).
  const least = target.threshold === ZERO ? 0 : Number((volumeLeft * BigInt(target.dayDivisor) + target.threshold - 1n) / target.threshold);
  return { tier: volume.tier + 1, volumeLeft, dayCap, daysNeeded: target.dayDivisor, daysLeast: least };
}

/** One tier's benefits as the account panel lists them. */
export interface Benefits {
  /** Where the first spread band ends in the market the panel shows, in USD; null for a market with one band. */
  bestPriceBound: Fixed | null;
  /** The most leverage in that market. */
  leverage: Fixed | null;
  maxRestingOrders: number | null;
  requestsPerSecond: number | null;
}

/** What `terms` brings in a market with these bands: its best-price size and its leverage, with each margin band charged at least `weekendBps` as the engine's `max_leverage` charges it. */
export function benefitsOf(terms: TierTerms, market: { spread_tiers: readonly SpreadTier[]; margin_tiers: readonly Tier[] } | undefined, weekendBps = 0): Benefits {
  return {
    bestPriceBound: market === undefined ? null : bestPriceBound(market.spread_tiers, terms.bestPriceShareBps),
    leverage: market === undefined ? null : maxLeverage(market.margin_tiers, Math.max(terms.marginFloorBps, weekendBps)),
    maxRestingOrders: terms.maxRestingOrders,
    requestsPerSecond: terms.requestsPerSecond,
  };
}

/** The margin `tiers` require at `notional` with the tier's floor, each band's charge rounded up as the engine's requirement rounds; the requirement the node's fills and withdrawals meet. */
export function flooredMargin(margin: readonly Tier[], notional: Fixed, floorBps: number): Fixed {
  return roundedUpCost(margin.map((tier) => ({ ...tier, bps: Math.max(tier.bps, floorBps) })), notional < ZERO ? -notional : notional);
}
