/** Locale-independent number formatting, so the server and the browser render the same text. */

/** Formats an integer count of `10^-dp` units as a decimal with `dp` places: `(1234567, 2)` → `12,345.67`. */
export function formatFixed(units: number, dp: number): string {
  const sign = units < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(units));
  const scale = 10 ** dp;
  const whole = groupThousands(Math.trunc(abs / scale));
  return dp === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(abs % scale).padStart(dp, "0")}`;
}

/** Formats an integer amount in cents as `12,345.67`. */
export function formatCents(cents: number): string {
  return formatFixed(cents, 2);
}

/** Formats an integer quantity in thousandths as `0.250`. */
export function formatMilli(milli: number): string {
  return formatFixed(milli, 3);
}

/** Formats an integer with an explicit sign, as `+1.3` or `-1.3` for `(±13, 1)`; zero has none. */
export function formatSigned(units: number, dp: number): string {
  return units > 0 ? `+${formatFixed(units, dp)}` : formatFixed(units, dp);
}

/** Groups a non-negative integer's digits in threes: `1234567` → `1,234,567`. */
export function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Shortens a `0x…` hex string to its first and last few digits. */
export function shortHex(hex: string, head = 6, tail = 4): string {
  if (hex.length <= 2 + head + tail) return hex;
  return `${hex.slice(0, 2 + head)}…${hex.slice(-tail)}`;
}

/** Formats a move in basis points as a signed percentage: `(24, ...)` → `+0.24%`; zero has no sign. */
export function formatMovePercent(bps: number): string {
  const abs = Math.abs(Math.trunc(bps));
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}%`;
  return bps > 0 ? `+${text}` : bps < 0 ? `−${text}` : text;
}
