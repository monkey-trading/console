/** The engine's fixed-point numbers: signed decimals with nine places, held as scaled bigints. */

/** A signed decimal scaled by 10^9, as the engine's `Fixed`; the wire form is a decimal string. */
export type Fixed = bigint;

export const DECIMALS = 9;
export const SCALE: Fixed = 1_000_000_000n;
export const ZERO: Fixed = 0n;

const DECIMAL = /^(-?)(\d+)(?:\.(\d{1,9}))?$/;

/** A whole number as a `Fixed`. */
export function fixedFromInt(n: number): Fixed {
  return BigInt(Math.trunc(n)) * SCALE;
}

/**
 * Parses a decimal string, or returns `null` for anything that is not one: signs other than a
 * leading minus, exponents, more than nine places, and empty text all refuse.
 */
export function parseFixed(text: string): Fixed | null {
  const match = DECIMAL.exec(text.trim());
  if (!match) return null;
  const [, sign, whole = "0", frac = ""] = match;
  const value = BigInt(whole) * SCALE + BigInt(frac.padEnd(DECIMALS, "0"));
  return sign === "-" ? -value : value;
}

/**
 * Parses a decimal string that came from the engine.
 * Error cases:
 * - the text is not a decimal; the engine never sends one, so this is a broken invariant
 */
export function fixedFromWire(text: string): Fixed {
  const value = parseFixed(text);
  if (value === null) throw new Error(`engine sent a malformed decimal: ${text}`);
  return value;
}

/** The shortest exact decimal string, with no trailing zeros, as the engine serializes `Fixed`. */
export function fixedToWire(value: Fixed): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

/** `a * b`, truncated toward zero. */
export function mulFixed(a: Fixed, b: Fixed): Fixed {
  return (a * b) / SCALE;
}

/**
 * `a / b`, truncated toward zero.
 * Error cases:
 * - `b` is zero; callers check the divisor first
 */
export function divFixed(a: Fixed, b: Fixed): Fixed {
  if (b === 0n) throw new Error("divFixed: division by zero");
  return (a * SCALE) / b;
}

/** `value` times `bps` basis points, truncated toward zero. */
export function bpsOf(value: Fixed, bps: number): Fixed {
  return (value * BigInt(Math.trunc(bps))) / 10_000n;
}

/** The signed distance from `from` to `to`, in basis points of `from`, truncated toward zero. */
export function moveBps(from: Fixed, to: Fixed): number {
  if (from === 0n) return 0;
  return Number(((to - from) * 10_000n) / from);
}

export function absFixed(value: Fixed): Fixed {
  return value < 0n ? -value : value;
}

export function minFixed(a: Fixed, b: Fixed): Fixed {
  return a < b ? a : b;
}

export function maxFixed(a: Fixed, b: Fixed): Fixed {
  return a > b ? a : b;
}

/** `value` as a number, for layout and charts only, never for a value that mirrors engine state. */
export function fixedToNumber(value: Fixed): number {
  return Number(value) / Number(SCALE);
}

/** Groups the digits of a non-negative integer string in threes. */
function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * `value` with exactly `dp` places (0 to 9), truncated toward zero and grouped in thousands, such
 * as `12,345.60`. Formats without the visitor's locale, so the server and the browser agree.
 */
export function formatFixedPlaces(value: Fixed, dp: number): string {
  const abs = absFixed(value);
  const scale = 10n ** BigInt(DECIMALS - dp);
  const units = abs / scale;
  const sign = value < 0n && units !== 0n ? "-" : "";
  const unit = 10n ** BigInt(dp);
  const whole = group((units / unit).toString());
  const frac = dp === 0 ? "" : `.${(units % unit).toString().padStart(dp, "0")}`;
  return `${sign}${whole}${frac}`;
}
