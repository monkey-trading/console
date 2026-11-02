/** The MONKEY page's figures: shares and ratios in integer arithmetic, durations, the stake amount a visitor types, and the halvings a schedule implies. */

import { EngineError } from "../engine/client";
import type { EmissionsView } from "../engine/stats-types";
import { parseFixed, SCALE, type Fixed } from "../fixed";
import { formatMonkey, groupThousands, MONKEY_UNIT } from "../format";
import { formatUsdc, USDC_UNIT } from "../vault";

/** Where a read stands: not answered yet, answered, refused by a node that has no such route, or failed. */
export type ReadStatus = "loading" | "ready" | "unavailable" | "failed";

export interface Read<T> {
  status: ReadStatus;
  /** The last answer, kept while a later read fails so a figure never blanks for a passing error. */
  value: T | null;
  message: string | null;
}

export const LOADING = { status: "loading", value: null, message: null } as const;

/** A read that answered. */
export function ready<T>(value: T): Read<T> {
  return { status: "ready", value, message: null };
}

/** What a failed read shows: a node that predates the route (404) is calmly unavailable, anything else is a failure with its message, and the last answer stays. */
export function failed<T>(error: unknown, held: T | null): Read<T> {
  if (error instanceof EngineError && error.status === 404) return { status: "unavailable", value: null, message: null };
  return { status: "failed", value: held, message: error instanceof Error ? error.message : "The read failed." };
}

/** `part` as a share of `total` in basis points, truncated and never over 100%; zero when `total` is not positive. */
export function shareBps(part: bigint, total: bigint): number {
  if (total <= 0n || part <= 0n) return 0;
  const bps = (part * 10_000n) / total;
  return Number(bps > 10_000n ? 10_000n : bps);
}

/** USDC base units as the `Fixed` that `formatUsdc` takes. */
export function usdcFixed(units: bigint): Fixed {
  return units * USDC_UNIT;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A span as its two largest units: `2d 4h`, `3h 12m`, `12m`, or `under a minute`. */
export function formatDuration(ms: number): string {
  const span = Math.max(0, Math.trunc(ms));
  const days = Math.floor(span / DAY);
  const hours = Math.floor((span % DAY) / HOUR);
  const minutes = Math.floor((span % HOUR) / MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return minutes > 0 ? `${minutes}m` : "under a minute";
}

/** How long ago `ms` was against `nowMs`: `4m ago`, or `just now` inside a minute. */
export function formatAgo(ms: number, nowMs: number): string {
  const span = nowMs - ms;
  return span < MINUTE ? "just now" : `${formatDuration(span)} ago`;
}

const AMOUNT = /^(\d+)(?:\.(\d{1,18}))?$/;

/**
 * The MONKEY base units a visitor's text names, or null for text that is not a positive amount
 * with at most eighteen places: signs, exponents, separators and zero all refuse.
 */
export function parseMonkeyAmount(text: string): bigint | null {
  const match = AMOUNT.exec(text.trim());
  if (!match) return null;
  const [, whole = "0", frac = ""] = match;
  const units = BigInt(whole) * MONKEY_UNIT + BigInt(frac.padEnd(18, "0"));
  return units > 0n ? units : null;
}

/** `units` as the exact amount a transaction moves, every place it has: `0.005 MONKEY`, never rounded away. */
export function monkeyExact(units: bigint): string {
  const frac = (units % MONKEY_UNIT).toString().padStart(18, "0").replace(/0+$/, "");
  return `${groupThousands(units / MONKEY_UNIT)}${frac === "" ? "" : `.${frac}`} MONKEY`;
}

/** The whole-MONKEY text for `units`, as the amount field takes it: all eighteen places trimmed of trailing zeros. */
export function monkeyInputText(units: bigint): string {
  const whole = units / MONKEY_UNIT;
  const frac = (units % MONKEY_UNIT).toString().padStart(18, "0").replace(/0+$/, "");
  return frac === "" ? whole.toString() : `${whole}.${frac}`;
}

/** The times, in milliseconds, at which the schedule halves the period budget inside `[fromMs, toMs]`. */
export function halvingsBetween(emissions: Pick<EmissionsView, "start_ms" | "period_ms" | "halving_periods">, fromMs: number, toMs: number): number[] {
  const span = emissions.halving_periods * emissions.period_ms;
  if (span <= 0) return [];
  const first = Math.max(1, Math.ceil((fromMs - emissions.start_ms) / span));
  const times: number[] = [];
  for (let k = first; emissions.start_ms + k * span <= toMs && times.length < 64; k += 1) times.push(emissions.start_ms + k * span);
  return times;
}

function toNumber(units: bigint, decimals: number): number {
  return Number((units * 1_000_000n) / 10n ** BigInt(decimals)) / 1_000_000;
}

/**
 * A series value as a number for the chart's axes, or null for a value or unit this page does
 * not know. Layout only: nothing a figure shows comes from this.
 */
export function plotValue(text: string, unit: string): number | null {
  if (unit === "monkey_base_units" || unit === "usdc_base_units") return /^\d+$/.test(text) ? toNumber(BigInt(text), unit === "usdc_base_units" ? 6 : 18) : null;
  // MONKEY base units per dollar of realised loss, written with nine places as `Fixed` is.
  if (unit === "monkey_base_units_per_usd") {
    const fixed = parseFixed(text);
    return fixed === null ? null : toNumber(fixed / SCALE, 18);
  }
  return null;
}

/** The node's decimal string of MONKEY base units as `formatMonkey` writes it, or a dash for text that is not one. */
export function monkeyText(units: string | null | undefined): string {
  return units === null || units === undefined || !/^\d+$/.test(units) ? "—" : formatMonkey(BigInt(units));
}

/** A series' last value as the node wrote it, in the words its unit calls for; a dash for text that is not a value. */
export function latestText(unit: string, text: string | null | undefined): string {
  if (text === null || text === undefined) return "—";
  if (unit === "usdc_base_units") return /^\d+$/.test(text) ? formatUsdc(usdcFixed(BigInt(text))) : "—";
  if (unit === "monkey_base_units") return monkeyText(text);
  // MONKEY base units per dollar, written with up to nine places: the whole base units are the figure.
  if (unit === "monkey_base_units_per_usd") return /^\d+(\.\d+)?$/.test(text) ? `${formatMonkey(BigInt(text.split(".")[0] ?? "0"))} per $1` : "—";
  return "—";
}

/** A chart axis label: `1.2K`, `3.46M`, `9.14B`, or two places below a thousand. Layout only. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(2);
}
