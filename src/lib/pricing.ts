/** Spreads, quotes and margin from a market's tiers, as the engine charges them. */

import { absFixed, bpsOf, fixedFromWire, maxFixed, minFixed, mulFixed, type Fixed, ZERO } from "./fixed";
import type { Side, Tier } from "./engine/types";

/** Extra spread each side pays, in basis points, at stress levels 0 to 3. */
export const STRESS_SPREAD_BPS = [0, 4, 12, 30] as const;

/** The share of a realised profit the house keeps, in basis points. */
export const PROFIT_FEE_BPS = 1_000;

/** An account is closed out when its equity falls below this share of its margin, in basis points. */
export const CLOSE_OUT_BPS = 5_000;

/** The highest stress level. */
export const MAX_STRESS = STRESS_SPREAD_BPS.length - 1;

/** The part of `[from, to)` inside a band that ends at `upTo` (unbounded when null) and starts at `lower`. */
function overlap(from: Fixed, to: Fixed, lower: Fixed, upTo: Fixed | null): Fixed {
  const top = upTo === null ? to : minFixed(to, upTo);
  return maxFixed(ZERO, top - maxFixed(from, lower));
}

/** What `tiers` charge on the slice of notional between `from` and `to`, each band on the part inside it, exactly. */
export function tierCost(tiers: readonly Tier[], from: Fixed, to: Fixed): Fixed {
  if (to <= from) return ZERO;
  let lower = ZERO;
  let charged = ZERO;
  for (const tier of tiers) {
    const upTo = tier.up_to === null ? null : fixedFromWire(tier.up_to);
    charged += bpsOf(overlap(from, to, lower, upTo), tier.bps);
    if (upTo !== null) lower = upTo;
  }
  return charged;
}

/** The weighted basis points `tiers` charge on that slice, truncated toward zero, for display. */
export function slicedBps(tiers: readonly Tier[], from: Fixed, to: Fixed): number {
  return to <= from ? 0 : Number((tierCost(tiers, from, to) * 10_000n) / (to - from));
}

/** The initial margin `tiers` require for a position of `notional` (absolute, in dollars). */
export function tieredMargin(tiers: readonly Tier[], notional: Fixed): Fixed {
  return tierCost(tiers, ZERO, absFixed(notional));
}

/**
 * How an order of signed quantity `delta` against a holding of `held` adds risk. The slice that
 * grows the absolute position runs from the held size, or from zero when the order flips the
 * position to the other side, up to the new size; an order that only reduces adds none.
 */
export function growthOf(held: Fixed, delta: Fixed): { grows: boolean; fromQty: Fixed; toQty: Fixed } {
  const next = held + delta;
  const flips = held !== ZERO && (held > ZERO) !== (next > ZERO) && next !== ZERO;
  if (flips) return { grows: true, fromQty: ZERO, toQty: absFixed(next) };
  const grows = absFixed(next) > absFixed(held);
  return { grows, fromQty: absFixed(held), toQty: absFixed(next) };
}

export interface Quote {
  /** The price the order fills at, in dollars. */
  price: Fixed;
  /** The whole spread against the index, in basis points. */
  spreadBps: number;
}

/**
 * The quote for an order whose growing slice runs from `heldNotional` to `heldNotional +
 * orderNotional` (see `growthOf`): the index, moved against the trader by the base spread, the
 * stress add-on, and the exact size charge spread over the order.
 */
export function quoteFor(args: {
  index: Fixed;
  side: Side;
  baseSpreadBps: number;
  spreadTiers: readonly Tier[];
  stress: number;
  /** Notional where the growing slice starts, in dollars. */
  heldNotional: Fixed;
  /** Notional of the growing slice, in dollars; zero for an order that only reduces. */
  orderNotional: Fixed;
  /** Notional of the whole order, which the size charge is spread over; the engine divides by the full quantity. */
  executedNotional: Fixed;
}): Quote {
  const { index, side, spreadTiers, heldNotional, orderNotional, executedNotional } = args;
  const stressBps = STRESS_SPREAD_BPS[Math.min(args.stress, MAX_STRESS)] ?? 0;
  const flat = bpsOf(index, args.baseSpreadBps + stressBps);
  const sizeCost = orderNotional > ZERO ? tierCost(spreadTiers, heldNotional, heldNotional + orderNotional) : ZERO;
  const size = orderNotional > ZERO && executedNotional > ZERO ? (index * sizeCost) / executedNotional : ZERO;
  const move = flat + size;
  const spreadBps = Number((move * 10_000n) / index);
  return { price: side === "buy" ? index + move : index - move, spreadBps };
}

/** The quote for `qty` units on `side` against a holding of `held` units, with whether the order adds risk. */
export function quoteOrder(args: {
  index: Fixed;
  side: Side;
  baseSpreadBps: number;
  spreadTiers: readonly Tier[];
  stress: number;
  held: Fixed;
  qty: Fixed;
  /** Converts an amount in the market's quote currency to USD, which the spread tiers are in; omitted for a USD market. */
  toUsd?: (amount: Fixed) => Fixed;
}): Quote & { grows: boolean } {
  const growth = growthOf(args.held, args.side === "buy" ? args.qty : -args.qty);
  const usd = args.toUsd ?? ((amount: Fixed) => amount);
  const quote = quoteFor({
    index: args.index, side: args.side, baseSpreadBps: args.baseSpreadBps, spreadTiers: args.spreadTiers, stress: args.stress,
    heldNotional: usd(mulFixed(growth.fromQty, args.index)), orderNotional: usd(mulFixed(growth.toQty - growth.fromQty, args.index)),
    executedNotional: usd(mulFixed(args.qty, args.index)),
  });
  return { ...quote, grows: growth.grows };
}

/** Whether the live price is further from the quote than `capBps` allows, compared exactly in fixed point. */
export function exceedsSlippage(side: Side, quoted: Fixed, live: Fixed, capBps: number): boolean {
  const diff = side === "buy" ? live - quoted : quoted - live;
  return diff > ZERO && diff * 10_000n > quoted * BigInt(capBps);
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

/**
 * What filling `qty` units at `price` costs the account's equity right away: the spread paid against
 * the index, and the fee on any profit realised by closing all or part of the old side first.
 */
export function executionCost(args: { held: Fixed; entry: Fixed | null; delta: Fixed; price: Fixed; index: Fixed }): Fixed {
  const { held, delta, price, index } = args;
  // Any order against the other side of the holding closes up to the whole holding, and realises P&L on that part.
  const against = held !== ZERO && delta !== ZERO && (held > ZERO) !== (delta > ZERO);
  const closing = against ? (absFixed(delta) < absFixed(held) ? -delta : held) : ZERO;
  const realised = mulFixed(closing, price - (args.entry ?? price));
  const fee = realised > ZERO ? bpsOf(realised, PROFIT_FEE_BPS) : ZERO;
  return mulFixed(absFixed(delta), absFixed(price - index)) + fee;
}
