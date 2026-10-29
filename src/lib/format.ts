/** Locale-independent text formatting, so the server and the browser render the same text. */

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
