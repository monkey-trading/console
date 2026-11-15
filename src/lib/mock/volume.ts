/**
 * The mock node's volume tiers, as `engine_core::volume_tier` counts them: opening notional is pending
 * until it has been held a minute, a close consumes the position's pending notional newest first, and
 * what it closes of matured notional counts once the round-trip horizon has passed. The engine's
 * round-trip matching (a reopening at the closing fill's index takes the close's volume back) is not
 * mirrored: the mock scores no toxicity, and a round trip here counts as the two fills it is.
 */

import type { MarketId } from "../engine/types";
import type { VolumeStandingWire } from "../engine/volume-types";
import { fixedToWire, minFixed, mulFixed, ZERO, type Fixed } from "../fixed";
import { closing, growth } from "../pricing";
import { bestPriceBound, type TierTerms } from "../volume-tier";

/** How long opening notional is held before it counts: a minute of the node's clock. */
export const MIN_HOLD_MS = 60_000;
/** How long a close waits for a reopening that would take its volume back. */
export const HORIZON_MS = 5_000;
export const DAY_MS = 24 * 60 * 60 * 1000;
/** The UTC days counted volume is kept for, the current one included. */
export const WINDOW_DAYS = 30;

interface OpeningLot {
  maturesAt: number;
  qty: Fixed;
  notional: Fixed;
}

interface ClosingLot {
  closedAt: number;
  notional: Fixed;
}

/** An account's counted volume by UTC day and the notional waiting to count. */
export interface VolumeBook {
  days: Map<number, Fixed>;
  opening: Map<MarketId, OpeningLot[]>;
  closing: ClosingLot[];
}

/** A book with nothing counted and nothing pending. */
export function newBook(): VolumeBook {
  return { days: new Map(), opening: new Map(), closing: [] };
}

const dayOf = (ms: number): number => Math.floor(ms / DAY_MS);

/** Adds `notional` to the counted volume of UTC `day`. */
function count(book: VolumeBook, day: number, notional: Fixed): void {
  book.days.set(day, (book.days.get(day) ?? ZERO) + notional);
}

/** Counts every lot whose time has come by `now` on its day. */
function settle(book: VolumeBook, now: number): void {
  for (const [market, lots] of book.opening) {
    const kept: OpeningLot[] = [];
    for (const lot of lots) {
      if (lot.maturesAt <= now) count(book, dayOf(lot.maturesAt), lot.notional);
      else kept.push(lot);
    }
    if (kept.length === 0) book.opening.delete(market);
    else book.opening.set(market, kept);
  }
  book.closing = book.closing.filter((lot) => {
    if (lot.closedAt + HORIZON_MS > now) return true;
    count(book, dayOf(lot.closedAt), lot.notional);
    return false;
  });
}

/**
 * Records a fill of signed `delta` against `held` at `price`: its growing slice is opening notional
 * that matures after the hold, its closing slice consumes pending notional newest first and the rest
 * of it, matured notional, counts after the horizon; a close-out counts at once.
 */
export function recordFill(book: VolumeBook, fill: { market: MarketId; held: Fixed; delta: Fixed; price: Fixed; now: number; liquidation: boolean }): void {
  const { market, now, price } = fill;
  settle(book, now);
  const [growFrom, growTo] = growth(fill.held, fill.delta);
  const [closeFrom, closeTo] = closing(fill.held, fill.delta);
  let toClose = closeTo - closeFrom;
  const lots = book.opening.get(market) ?? [];
  while (toClose > ZERO && lots.length > 0) {
    const lot = lots[lots.length - 1];
    if (lot === undefined) break;
    const taken = minFixed(toClose, lot.qty);
    // The units a close takes from a lot count nothing: they were never held long enough.
    // What a lot keeps is its proportion rounded down, as the engine's `consume_opening` keeps it, so a partial close never leaves more pending than it should.
    if (taken === lot.qty) lots.pop();
    else lots[lots.length - 1] = { ...lot, qty: lot.qty - taken, notional: (lot.notional * (lot.qty - taken)) / lot.qty };
    toClose -= taken;
  }
  if (toClose > ZERO) {
    const notional = mulFixed(toClose, price);
    if (fill.liquidation) count(book, dayOf(now), notional);
    else book.closing.push({ closedAt: now, notional });
  }
  if (growTo > growFrom) lots.push({ maturesAt: now + MIN_HOLD_MS, qty: growTo - growFrom, notional: mulFixed(growTo - growFrom, price) });
  if (lots.length > 0) book.opening.set(market, lots);
  else book.opening.delete(market);
}

/** The volume counted on each day of the window that ends on `now`'s day, oldest first, every lot whose time has come included. */
export function windowDays(book: VolumeBook, now: number): Fixed[] {
  const first = dayOf(now) - (WINDOW_DAYS - 1);
  const days = Array.from({ length: WINDOW_DAYS }, () => ZERO);
  const add = (day: number, notional: Fixed) => {
    const slot = day - first;
    if (slot >= 0 && slot < WINDOW_DAYS) days[slot] = (days[slot] ?? ZERO) + notional;
  };
  for (const [day, volume] of book.days) add(day, volume);
  for (const lot of [...book.opening.values()].flat()) if (lot.maturesAt <= now) add(dayOf(lot.maturesAt), lot.notional);
  for (const lot of book.closing) if (lot.closedAt + HORIZON_MS <= now) add(dayOf(lot.closedAt), lot.notional);
  return days;
}

/** A day's volume towards `tier`, times its day divisor so no cap is rounded: at most the threshold. */
const dayShare = (volume: Fixed, tier: TierTerms): Fixed => minFixed(volume * BigInt(tier.dayDivisor), tier.threshold);
const cappedTimesDivisor = (days: readonly Fixed[], tier: TierTerms): Fixed => days.reduce((sum, volume) => sum + dayShare(volume, tier), ZERO);

/** The highest tier whose capped volume in the window reaches its threshold. */
export function tierOf(days: readonly Fixed[], tiers: readonly TierTerms[]): number {
  let found = 0;
  tiers.forEach((tier, index) => {
    if (cappedTimesDivisor(days, tier) >= tier.threshold * BigInt(tier.dayDivisor)) found = index;
  });
  return found;
}

/** The account's tier now, 0 when the mock's parameters name no table. */
export function tierNow(book: VolumeBook, tiers: readonly TierTerms[], now: number): number {
  return tiers.length === 0 ? 0 : tierOf(windowDays(book, now), tiers);
}

/** `GET /v1/accounts/{address}`'s `volume`: tier, counted and pending volume, progress towards each tier and best-price bounds. */
export function standingOf(
  book: VolumeBook, tiers: readonly TierTerms[], now: number, markets: ReadonlyMap<MarketId, { spread_tiers: Parameters<typeof bestPriceBound>[0] }>,
): VolumeStandingWire {
  const days = windowDays(book, now);
  const tier = tierOf(days, tiers);
  const progress = tiers.map((level) => ({
    capped: fixedToWire(cappedTimesDivisor(days, level) / BigInt(level.dayDivisor)),
    days: days.filter((volume) => volume > ZERO && dayShare(volume, level) === level.threshold).length,
  }));
  let pending = ZERO;
  for (const lot of [...book.opening.values()].flat()) if (lot.maturesAt > now) pending += lot.notional;
  for (const lot of book.closing) if (lot.closedAt + HORIZON_MS > now) pending += lot.notional;
  const share = tiers[tier]?.bestPriceShareBps;
  const bounds: Record<string, string> = {};
  if (share !== undefined) {
    for (const [id, market] of markets) {
      const bound = bestPriceBound(market.spread_tiers, share);
      if (bound !== null) bounds[String(id)] = fixedToWire(bound);
    }
  }
  const terms = tiers[tier];
  return {
    tier, matured: fixedToWire(days.reduce((sum, volume) => sum + volume, ZERO)), pending: fixedToWire(pending), progress, best_price_bounds: bounds,
    ...(terms?.maxRestingOrders == null ? {} : { max_resting_orders: terms.maxRestingOrders }),
    ...(terms?.requestsPerSecond == null ? {} : { requests_per_second: terms.requestsPerSecond }),
    // The mock runs V68: the tier's benefits as the table names them, zero included.
    ...(terms === undefined ? {} : { fee_discount_bps: terms.feeDiscountBps, financing_discount_bps: terms.financingDiscountBps, emissions_boost_bps: terms.emissionsBoostBps }),
  };
}
