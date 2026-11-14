/**
 * Spreads, prices and margin from a market's bands, as the engine charges them from V52
 * (`crates/core/src/execution/mod.rs`, `Engine::price`): the mock node fills with these, and the
 * mock build's ticket shows them; a live build takes its prices from the node's signed quotes.
 */

import { absFixed, bpsOf, fixedFromWire, maxFixed, minFixed, mulFixed, type Fixed, ZERO } from "./fixed";
import { divRounded, mulBpsRounded, mulRounded, type Rounding } from "./fixed-rounding";
import type { MarketView, Reject, Side, SpreadTier, StressLevel, Tier } from "./engine/types";
import { profitFee } from "./holding-fee";
import { spreadStaircase } from "./spread-bands";

/** An account is closed out when its equity falls below this share of its margin, in basis points. */
export const CLOSE_OUT_BPS = 5_000;

/** What a market's stress level adds to a fill: a spread on every fill, in bps, and a multiplier on the size spread, in bps (10,000 is 1x). */
export interface StressTerms {
  minSpreadBps: number;
  sizeMultiplierBps: number;
}

/** Level 0 as the engine's genesis lists it: no minimum and the size spread at 1x. */
export const CALM: StressTerms = { minSpreadBps: 0, sizeMultiplierBps: 10_000 };

/** The terms of stress `level` from the node's levels, or undefined when they are not known (no parameters read, or a level they do not list). */
export function stressTermsAt(levels: readonly StressLevel[] | undefined, level: number): StressTerms | undefined {
  const found = levels?.[level];
  return found === undefined ? undefined : { minSpreadBps: found.min_spread_bps, sizeMultiplierBps: found.size_spread_multiplier_bps };
}

/** How a market's quote currency converts to USD and back at its FX index, each rounded as asked (`QuoteCurrency::to_usd`, `from_usd`). */
export interface Conversion {
  toUsd(amount: Fixed, rounding: Rounding): Fixed;
  fromUsd(amount: Fixed, rounding: Rounding): Fixed;
}

/** A USD market's conversion: none. */
export const USD: Conversion = { toUsd: (amount) => amount, fromUsd: (amount) => amount };

/**
 * The conversion for `view` when its price is `price`: through its FX mark, or `price` itself for the
 * pair's own listing (USD-JPY). Null for a market quoted in another currency with no FX price yet.
 */
export function conversionAt(view: MarketView, price: Fixed): Conversion | null {
  const currency = view.quote_currency;
  if (currency === undefined) return USD;
  const fx = currency.fx_market === view.id ? price : view.fx_mark == null ? null : fixedFromWire(view.fx_mark);
  if (fx === null) return null;
  return currency.currency === "jpy"
    ? { toUsd: (amount, rounding) => divRounded(amount, fx, rounding), fromUsd: (amount, rounding) => mulRounded(amount, fx, rounding) }
    : { toUsd: (amount, rounding) => mulRounded(amount, fx, rounding), fromUsd: (amount, rounding) => divRounded(amount, fx, rounding) };
}

/** The part of `[from, to)` inside a band that ends at `upTo` (unbounded when null) and starts at `lower`. */
function overlap(from: Fixed, to: Fixed, lower: Fixed, upTo: Fixed | null): Fixed {
  const top = upTo === null ? to : minFixed(to, upTo);
  return maxFixed(ZERO, top - maxFixed(from, lower));
}

/** What margin `tiers` charge on the slice of notional between `from` and `to`, each band on the part inside it, exactly. */
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

/** The weighted basis points margin `tiers` charge on that slice, truncated toward zero, for display. */
export function slicedBps(tiers: readonly Tier[], from: Fixed, to: Fixed): number {
  return to <= from ? 0 : Number((tierCost(tiers, from, to) * 10_000n) / (to - from));
}

/** The initial margin `tiers` require for a position of `notional` (absolute, in dollars). */
export function tieredMargin(tiers: readonly Tier[], notional: Fixed): Fixed {
  return tierCost(tiers, ZERO, absFixed(notional));
}

/** The slice of a trade that grows |position|, as absolute quantities: the whole of an increase, the new side of a flip, nothing for a pure reduction (`validation::growth`). */
export function growth(held: Fixed, delta: Fixed): [Fixed, Fixed] {
  const next = held + delta;
  if (held === ZERO || (held > ZERO) === (delta > ZERO)) return [absFixed(held), absFixed(next)];
  if (next !== ZERO && (next > ZERO) === (delta > ZERO)) return [ZERO, absFixed(next)];
  return [ZERO, ZERO];
}

/** The slice of a trade that closes |position|: from what the position falls to up to what it held, for a trade on the other side (`validation::closing`). */
export function closing(held: Fixed, delta: Fixed): [Fixed, Fixed] {
  if (held === ZERO || (held > ZERO) === (delta > ZERO)) return [ZERO, ZERO];
  const size = absFixed(held);
  return [size - minFixed(absFixed(delta), size), size];
}

/** Whether an order of signed quantity `delta` against a holding of `held` adds risk: it grows the absolute position. */
export function growthOf(held: Fixed, delta: Fixed): { grows: boolean } {
  const [from, to] = growth(held, delta);
  return { grows: to > from };
}

export interface PricingInput {
  /** The market's index mid. */
  mid: Fixed;
  side: Side;
  /** The signed quantity the account holds. */
  held: Fixed;
  /** The order's quantity, above zero. */
  qty: Fixed;
  tiers: readonly SpreadTier[];
  stress: StressTerms;
  /** The account's toxicity add-on, in bps; a close-out pays none. */
  toxicityBps: number;
  /** The market's close-spread ceiling in bps, or null with none. */
  ceilingBps: number | null;
  conversion: Conversion;
}

/** An order's price and the spread in it (exact: `price` minus `mid`, signed for the side), or the engine's refusal of it. */
export type Priced = { kind: "priced"; price: Fixed; spread: Fixed; increases: boolean } | { kind: "refused"; reject: Reject };

/**
 * The price a market order of `qty` pays now, as `Engine::price` computes it from V52 (the market's
 * hours, its index and the order's minimum are the caller's): the stress minimum and toxicity add-on
 * over the whole quantity, and the size spread on the slice that grows the position and the slice that
 * closes it, both at the stress multiplier, every charge rounded up. A pure close's charge is clamped
 * to its ceiling, a reversal over it is refused, and a spread that reaches the price is refused.
 */
export function priceOrder(input: PricingInput): Priced {
  const { mid, side, held, qty, conversion } = input;
  const delta = side === "buy" ? qty : -qty;
  const [growFrom, growTo] = growth(held, delta);
  const [closeFrom, closeTo] = closing(held, delta);
  const increases = growTo > growFrom;
  const parts = (charge: Rounding): Fixed => {
    const slice = (from: Fixed, to: Fixed) =>
      spreadStaircase(input.tiers, conversion.toUsd(mulFixed(from, mid), "down"), conversion.toUsd(mulRounded(to, mid, charge), "up"), charge);
    const sizeUsd = mulBpsRounded(slice(growFrom, growTo) + slice(closeFrom, closeTo), input.stress.sizeMultiplierBps, charge);
    const size = conversion.fromUsd(sizeUsd, "up");
    return mulBpsRounded(mid, input.stress.minSpreadBps + input.toxicityBps, charge) + divRounded(size, qty, charge);
  };
  const closes = held !== ZERO && (side === "buy") !== (held > ZERO);
  const bound = input.ceilingBps === null ? null : (mid * BigInt(input.ceilingBps)) / 10_000n;
  const overCeiling = (charge: Fixed) => input.ceilingBps !== null && charge * 10_000n > mid * BigInt(input.ceilingBps);
  // The truncated spread decides whether it reaches the price: a reversal over its ceiling is classified first, and a pure close is clamped to its ceiling before the check.
  const truncated = parts("toward-zero");
  const checked = closes && !increases && bound !== null ? minFixed(truncated, bound) : truncated;
  if (!(closes && increases && overCeiling(truncated)) && checked >= mid) return { kind: "refused", reject: { kind: "invalid_order", reason: "spread at this size reaches the price" } };
  const charge = parts("up");
  if (closes && increases && input.ceilingBps !== null && overCeiling(charge)) return { kind: "refused", reject: { kind: "close_spread_ceiling", ceiling_bps: input.ceilingBps } };
  const rounded = closes && !increases && bound !== null ? minFixed(charge, bound) : charge;
  const spread = side === "sell" ? minFixed(rounded, mid - 1n) : rounded;
  return { kind: "priced", price: side === "buy" ? mid + spread : mid - spread, spread, increases };
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
 * the index, and the fee at `feeBps` on any profit realised by closing all or part of the old side first.
 */
export function executionCost(args: { held: Fixed; entry: Fixed | null; delta: Fixed; price: Fixed; index: Fixed; feeBps: number }): Fixed {
  const { held, delta, price, index } = args;
  // Any order against the other side of the holding closes up to the whole holding, and realises P&L on that part.
  const against = held !== ZERO && delta !== ZERO && (held > ZERO) !== (delta > ZERO);
  const closingQty = against ? (absFixed(delta) < absFixed(held) ? -delta : held) : ZERO;
  const realised = mulFixed(closingQty, price - (args.entry ?? price));
  return mulFixed(absFixed(delta), absFixed(price - index)) + profitFee(realised, args.feeBps);
}
