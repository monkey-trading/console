/** Spreads, quotes and margin from a market's tiers, as the engine charges them. */

import { absFixed, bpsOf, fixedFromWire, maxFixed, minFixed, mulFixed, type Fixed, ZERO } from "./fixed";
import type { Side, Tier } from "./engine/types";

/** Extra spread each side pays, in basis points, at stress levels 0 to 3. */
export const STRESS_SPREAD_BPS = [0, 4, 12, 30] as const;

/** An account is closed out when its equity falls below this share of its margin, in basis points. */
export const CLOSE_OUT_BPS = 5_000;

/** The highest stress level. */
export const MAX_STRESS = STRESS_SPREAD_BPS.length - 1;

/** The part of `[from, to)` inside a band that ends at `upTo` (unbounded when null) and starts at `lower`. */
function overlap(from: Fixed, to: Fixed, lower: Fixed, upTo: Fixed | null): Fixed {
  const top = upTo === null ? to : minFixed(to, upTo);
  return maxFixed(ZERO, top - maxFixed(from, lower));
}

/**
 * The weighted basis points `tiers` charge on the slice of notional between `from` and `to`, each
 * band applying to the part of the slice inside it. Truncates toward zero.
 */
export function slicedBps(tiers: readonly Tier[], from: Fixed, to: Fixed): number {
  const width = to - from;
  if (width <= ZERO) return 0;
  let lower = ZERO;
  let charged = ZERO;
  for (const tier of tiers) {
    const upTo = tier.up_to === null ? null : fixedFromWire(tier.up_to);
    charged += bpsOf(overlap(from, to, lower, upTo), tier.bps);
    if (upTo !== null) lower = upTo;
  }
  return Number((charged * 10_000n) / width);
}

/** The initial margin `tiers` require for a position of `notional` (absolute, in dollars). */
export function tieredMargin(tiers: readonly Tier[], notional: Fixed): Fixed {
  return bpsOf(absFixed(notional), slicedBps(tiers, ZERO, absFixed(notional)));
}

/** The most leverage the first margin band allows, such as 50 for a two percent band. */
export function maxLeverage(tiers: readonly Tier[]): number {
  const first = tiers[0];
  return first && first.bps > 0 ? Math.floor(10_000 / first.bps) : 1;
}

export interface Quote {
  /** The price the order fills at, in dollars. */
  price: Fixed;
  /** The whole spread against the index, in basis points. */
  spreadBps: number;
}

/**
 * The quote for an order of `notional` that takes the position from `held` to `held + signed`:
 * the index, moved against the trader by the base spread, the stress add-on, and the size spread
 * on the slice that grows the account's absolute notional.
 */
export function quoteFor(args: {
  index: Fixed;
  side: Side;
  baseSpreadBps: number;
  spreadTiers: readonly Tier[];
  stress: number;
  heldNotional: Fixed;
  orderNotional: Fixed;
  /** Whether the order grows the account's absolute position. */
  grows: boolean;
}): Quote {
  const { index, side, spreadTiers, heldNotional, orderNotional } = args;
  const sizeBps = args.grows ? slicedBps(spreadTiers, absFixed(heldNotional), absFixed(heldNotional) + orderNotional) : 0;
  const stressBps = STRESS_SPREAD_BPS[Math.min(args.stress, MAX_STRESS)] ?? 0;
  const spreadBps = args.baseSpreadBps + stressBps + sizeBps;
  const move = bpsOf(index, spreadBps);
  return { price: side === "buy" ? index + move : index - move, spreadBps };
}

/** Largest adverse move from `quoted` to `live`, in basis points; zero when `live` is better. */
export function adverseBps(side: Side, quoted: Fixed, live: Fixed): number {
  if (quoted === ZERO) return 0;
  const diff = side === "buy" ? live - quoted : quoted - live;
  return diff <= ZERO ? 0 : Number((diff * 10_000n) / quoted);
}

/** `qty` units at `price`, in dollars. */
export function notionalOf(qty: Fixed, price: Fixed): Fixed {
  return absFixed(mulFixed(qty, price));
}
