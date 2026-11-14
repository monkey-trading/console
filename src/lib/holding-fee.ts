/**
 * The profit fee that falls with holding time, from V55, as `engine_core::holding_fee` computes it.
 *
 * A realised gain pays the larger of the base fee (`profit_fee_bps`) and the hold curve's fee at the
 * hold of the slice it closes. The curve is a table of points, ascending in hold and falling in fee:
 * the first point's fee at and below its hold, linear between points with the fee rounded up to the
 * bp, and zero at and past the last point's hold, where the base alone applies. Holds are whole
 * milliseconds of sequenced time and fees whole bps, so plain integers hold them exactly.
 */

import type { CurvePoint } from "./engine/types";
import { ZERO, type Fixed } from "./fixed";
import { mulBpsRounded } from "./fixed-rounding";

/**
 * The engine's default curve (`DEFAULT_PROFIT_FEE_CURVE`), which its dev and production geneses carry:
 * the whole gain to 10 s, falling to 10% at 15 minutes, eleven holds spaced evenly in the logarithm.
 */
export const LAUNCH_CURVE: readonly CurvePoint[] = [
  [10_000, 10_000], [15_683, 9_100], [24_596, 8_200], [38_573, 7_300], [60_492, 6_400], [94_869, 5_500],
  [148_781, 4_600], [233_330, 3_700], [365_927, 2_800], [573_877, 1_900], [900_000, 1_000],
].map(([hold_ms = 0, fee_bps = 0]) => ({ hold_ms, fee_bps }));

/** `num / den` rounded up, for `num >= 0` and `den > 0`: the engine's `ceil_div`. */
function ceilDiv(num: number, den: number): number {
  return Math.floor((num + den - 1) / den);
}

/** How many of `curve`'s points have a hold at or below `holdMs`: Rust's `partition_point` over the ascending holds. */
function pointsUpTo(curve: readonly CurvePoint[], holdMs: number): number {
  let count = 0;
  while (count < curve.length && (curve[count]?.hold_ms ?? Infinity) <= holdMs) count += 1;
  return count;
}

/**
 * The point at `index`, which callers keep inside the curve.
 * Error cases:
 * - `index` outside the curve, which the callers' bounds rule out
 */
function point(curve: readonly CurvePoint[], index: number): CurvePoint {
  const found = curve[index];
  if (found === undefined) throw new Error(`no curve point ${index} in a curve of ${curve.length}`);
  return found;
}

/** The hold at and past which `curve` charges nothing: its last point's, or zero for an empty curve (`last_hold`). */
export function lastHold(curve: readonly CurvePoint[]): number {
  return curve[curve.length - 1]?.hold_ms ?? 0;
}

/** `curve`'s fee at `holdMs`: the first fee at and below the first hold, linear between points rounded up to the bp, and zero at and past the last hold (`curve_fee_bps`). */
export function curveFeeBps(curve: readonly CurvePoint[], holdMs: number): number {
  const past = pointsUpTo(curve, holdMs);
  if (past === 0) return curve[0]?.fee_bps ?? 0;
  if (past === curve.length) return 0;
  const from = point(curve, past - 1);
  const to = point(curve, past);
  // The fee falls by `from.fee - to.fee` over the span; `left` of it is still to fall.
  return to.fee_bps + ceilDiv((from.fee_bps - to.fee_bps) * (to.hold_ms - holdMs), to.hold_ms - from.hold_ms);
}

/** The fee rate on a gain held `holdMs`: the larger of `baseBps` and `curve`'s fee there (`fee_at`). */
export function feeAt(baseBps: number, curve: readonly CurvePoint[], holdMs: number): number {
  return Math.max(baseBps, curveFeeBps(curve, holdMs));
}

/**
 * The least hold past `holdMs` at which `feeAt(baseBps, curve, ..)` is lower than at `holdMs`, or null
 * when it never falls again: once the curve is at or below the base (`next_fall`).
 */
export function nextFall(baseBps: number, curve: readonly CurvePoint[], holdMs: number): number | null {
  const now = curveFeeBps(curve, holdMs);
  if (now <= baseBps) return null;
  // The curve is above the base, so it has points and `holdMs` is short of the last. It next falls in the
  // first segment from here whose far end is below `now`, where its linear part reaches `now - 1`.
  for (let n = Math.max(pointsUpTo(curve, holdMs), 1); n < curve.length; n += 1) {
    const from = point(curve, n - 1);
    const to = point(curve, n);
    if (to.fee_bps < now) return from.hold_ms + ceilDiv((from.fee_bps - now + 1) * (to.hold_ms - from.hold_ms), from.fee_bps - to.fee_bps);
  }
  // Flat to the last point, where the curve drops to zero.
  return lastHold(curve);
}

/**
 * The least hold at which the fee is the base and falls no further: zero when the curve never rises
 * above the base. The fee never rises with the hold, so the search halves the range to the curve's end.
 */
export function baseFrom(baseBps: number, curve: readonly CurvePoint[]): number {
  let low = 0;
  let high = lastHold(curve);
  if (curveFeeBps(curve, low) <= baseBps) return 0;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (curveFeeBps(curve, mid) <= baseBps) high = mid;
    else low = mid;
  }
  return high;
}

/**
 * The profit fee on a realised gain at `feeBps`, rounded up; a loss pays nothing (`execution::profit_fee`
 * from V5). `realised` is in USD.
 */
export function profitFee(realised: Fixed, feeBps: number): Fixed {
  return realised > ZERO ? mulBpsRounded(realised, feeBps, "up") : ZERO;
}

/**
 * The open time after a fill takes a position of `before` units, opened at `openedAt`, to `after` units
 * at `now`, under a curve whose last hold is `curveEnd` (`opened_after`): none once flat; now for an
 * opening or a flip; for an add, the size-weighted average of now and the open time raised to no
 * earlier than `now - curveEnd`, rounded towards now; and the open time as it was for a reduction.
 */
export function openedAfter(before: Fixed, openedAt: number | null, after: Fixed, now: number, curveEnd: number): number | null {
  if (after === ZERO) return null;
  const sameSide = before !== ZERO && (before > ZERO) === (after > ZERO);
  if (openedAt === null || !sameSide) return now;
  const held = before < ZERO ? -before : before;
  const total = after < ZERO ? -after : after;
  if (total <= held) return openedAt;
  // A held position lends an add at most the curve's length of age.
  const from = Math.max(openedAt, now - curveEnd);
  // `from + (now - from) * added / after`, the share of the wait rounded up from the exact product, as `Fixed::mul_div` does.
  const moved = (BigInt(now - from) * (total - held) + total - 1n) / total;
  return from + Number(moved);
}

/** What closing a position pays at a moment: its hold, the fee rate on a gain, when that rate next falls and when it reaches the base (null once it has). */
export interface FeeNow {
  holdMs: number;
  feeBps: number;
  fallsAt: number | null;
  baseAt: number | null;
}

/**
 * What closing a position opened at `openedAt` pays at `now`, under `baseBps` and `curve`: the engine's
 * `close_fee` at that time, with the time the rate reaches the base added. A clock behind the open
 * time reads as no hold.
 */
export function feeNow(openedAt: number, baseBps: number, curve: readonly CurvePoint[], now: number): FeeNow {
  const holdMs = Math.max(0, now - openedAt);
  const falls = nextFall(baseBps, curve, holdMs);
  return {
    holdMs,
    feeBps: feeAt(baseBps, curve, holdMs),
    fallsAt: falls === null ? null : openedAt + falls,
    baseAt: falls === null ? null : openedAt + baseFrom(baseBps, curve),
  };
}
