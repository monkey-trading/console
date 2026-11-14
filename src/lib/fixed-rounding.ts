/**
 * The engine's three roundings of a fixed-point quotient (`engine_core::fixed::Rounding`), over the
 * console's bigint `Fixed`. A bigint product never overflows, so each is one exact division.
 */

import { SCALE, type Fixed } from "./fixed";

/** Toward negative infinity, toward positive infinity, or toward zero, as the engine names them. */
export type Rounding = "down" | "up" | "toward-zero";

/**
 * `n / d` rounded as `rounding` says: the engine's `round_div`.
 * Error cases:
 * - `d` is zero; callers check the divisor first
 */
export function roundDiv(n: bigint, d: bigint, rounding: Rounding): bigint {
  if (d === 0n) throw new Error("roundDiv: division by zero");
  const quotient = n / d;
  const remainder = n % d;
  // Truncation leaves the exact quotient above `quotient` when the remainder has the divisor's sign.
  const above = remainder !== 0n && (remainder < 0n) === (d < 0n);
  if (rounding === "down" && remainder !== 0n && !above) return quotient - 1n;
  if (rounding === "up" && above) return quotient + 1n;
  return quotient;
}

/** `a * b`, rounded as `rounding` says: `Fixed::mul_rounded`. */
export function mulRounded(a: Fixed, b: Fixed, rounding: Rounding): Fixed {
  return roundDiv(a * b, SCALE, rounding);
}

/** `a / b`, rounded as `rounding` says: `Fixed::div_rounded`. The divisor is not zero. */
export function divRounded(a: Fixed, b: Fixed, rounding: Rounding): Fixed {
  return roundDiv(a * SCALE, b, rounding);
}

/** `bps` basis points of `value`, rounded as `rounding` says: `Fixed::mul_bps_rounded`. */
export function mulBpsRounded(value: Fixed, bps: number, rounding: Rounding): Fixed {
  return roundDiv(value * BigInt(Math.trunc(bps)), 10_000n, rounding);
}

/** `tenthBps` tenths of a basis point of `value`, rounded as `rounding` says: `Fixed::mul_tenth_bps_rounded`. */
export function mulTenthBpsRounded(value: Fixed, tenthBps: number, rounding: Rounding): Fixed {
  return roundDiv(value * BigInt(Math.trunc(tenthBps)), 100_000n, rounding);
}

/**
 * `value` rounded to `places` decimal places (0 to 9) as `rounding` says, so a bound shown to the cent or
 * to a market's places stays true: an "at most" figure rounds up, an "at least" one down.
 */
export function roundToPlaces(value: Fixed, places: number, rounding: Rounding): Fixed {
  const unit = 10n ** BigInt(9 - places);
  return roundDiv(value, unit, rounding) * unit;
}
