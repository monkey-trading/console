/** Compact figures for chart axes and panels: floats, for display alone. */

import { groupThousands } from "./format";

const UNITS = [{ at: 1e12, suffix: "T" }, { at: 1e9, suffix: "B" }, { at: 1e6, suffix: "M" }, { at: 1e3, suffix: "K" }] as const;

/** `value` in dollars as `$61.9M`, `-$3.2K` or `$850`, without the visitor's locale. */
export function formatCompactUsd(value: number): string {
  const abs = Math.abs(value);
  // The sign stays whenever the printed amount is not zero: two places below $10, so $0.005 is the smallest.
  const sign = value < 0 && abs >= 0.005 ? "-" : "";
  // The largest unit the value reaches, stepping up when rounding carries it to 1000 of the unit below ($999.6K would print as 1000K).
  let at = UNITS.findIndex((unit) => abs >= unit.at);
  const carries = at === -1 ? abs >= 999.5 : at > 0 && abs / (UNITS[at]?.at ?? 1) >= 999.5;
  if (carries) at = at === -1 ? UNITS.length - 1 : at - 1;
  const unit = UNITS[at];
  if (unit === undefined) return `${sign}$${abs.toFixed(abs < 10 ? 2 : 0)}`;
  const scaled = abs / unit.at;
  return `${sign}$${scaled.toFixed(scaled < 10 ? 2 : scaled < 100 ? 1 : 0)}${unit.suffix}`;
}

/** Whole base units from the wire's decimal text, or null for anything else. */
export function parseUnits(text: string): bigint | null {
  return /^\d+$/.test(text) ? BigInt(text) : null;
}

/** `units` of USDC (six decimals) as `1,842.50 USDC`, truncated to cents. */
export function formatUsdc(units: bigint): string {
  const cents = units / 10_000n;
  const whole = groupThousands(cents / 100n);
  return `${whole}.${(cents % 100n).toString().padStart(2, "0")} USDC`;
}
