/** Locale-independent text formatting, so the server and the browser render the same text. */

/** Groups a non-negative integer's digits in threes: `1234567` → `1,234,567`. */
export function groupThousands(n: number | bigint): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Shortens a `0x…` hex string to its first and last few digits. */
export function shortHex(hex: string, head = 6, tail = 4): string {
  if (hex.length <= 2 + head + tail) return hex;
  return `${hex.slice(0, 2 + head)}…${hex.slice(-tail)}`;
}

/** One MONKEY in base units: the token has 18 decimals, as the engine's entitlements count. */
export const MONKEY_UNIT = 10n ** 18n;

/**
 * `units` MONKEY base units as whole MONKEY, grouped in thousands with up to two places and no
 * trailing zeros: `1,234.5 MONKEY`. The unit stays a bigint, never a float.
 */
export function formatMonkey(units: bigint): string {
  const whole = units / MONKEY_UNIT;
  const frac = ((units % MONKEY_UNIT) * 100n) / MONKEY_UNIT;
  const grouped = groupThousands(whole);
  return frac === 0n ? `${grouped} MONKEY` : `${grouped}.${frac.toString().padStart(2, "0").replace(/0+$/, "")} MONKEY`;
}

/** Formats a rate in basis points as an unsigned percentage: `1000` → `10.00%`. */
export function formatRate(bps: number): string {
  const abs = Math.abs(Math.trunc(bps));
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}%`;
}

/** Formats a move in basis points as a signed percentage: `(24, ...)` → `+0.24%`; zero has no sign. */
export function formatMovePercent(bps: number): string {
  const abs = Math.abs(Math.trunc(bps));
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}%`;
  return bps > 0 ? `+${text}` : bps < 0 ? `−${text}` : text;
}
