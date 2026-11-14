/**
 * Size spread bands in tenths of a basis point, as the engine charges them from V52
 * (`engine_core::spread_tier`, `market::banded`), and how a rate in tenths reads on screen.
 */

import { formatCompactUsd } from "./chart-format";
import type { ListingNotice, SpreadTier, Tier } from "./engine/types";
import { fixedFromWire, fixedToNumber, maxFixed, minFixed, ZERO, type Fixed } from "./fixed";
import { mulTenthBpsRounded, type Rounding } from "./fixed-rounding";
import { formatRate } from "./format";
import { formatStamp } from "./time";

/** A band's rate in tenths of a bp, however the wire writes it: a band in whole bps is ten tenths a bp (`SpreadTier::tenth_bps`). */
export function tenthBpsOf(tier: SpreadTier): number {
  return "tenth_bps" in tier ? tier.tenth_bps : tier.bps * 10;
}

/**
 * The cost of moving from notional `from` to `to` (USD) through `tiers`: each band's rate on the
 * slice of `[from, to]` inside it, each band's charge rounded as `rounding` says. The engine's
 * `spread_staircase` over `banded`.
 */
export function spreadStaircase(tiers: readonly SpreadTier[], from: Fixed, to: Fixed, rounding: Rounding): Fixed {
  if (to <= from) return ZERO;
  let lower = ZERO;
  let charged = ZERO;
  for (const tier of tiers) {
    const upTo = tier.up_to === null ? null : fixedFromWire(tier.up_to);
    const start = maxFixed(from, lower);
    const end = upTo === null ? to : minFixed(to, upTo);
    if (end > start) charged += mulTenthBpsRounded(end - start, tenthBpsOf(tier), rounding);
    if (upTo !== null) lower = upTo;
  }
  return charged;
}

/** `part` as tenths of a bp of `base`, truncated toward zero; zero when `base` is not positive. */
export function tenthBpsOfValue(part: Fixed, base: Fixed): number {
  return base > 0n ? Number((part * 100_000n) / base) : 0;
}

/** A rate in tenths of a bp as basis points with the tenth shown when there is one: `4` → `0.4 bps`, `10` → `1 bp`, `125` → `12.5 bps`. */
export function formatTenthBps(tenths: number): string {
  const sign = tenths < 0 ? "−" : "";
  const abs = Math.abs(Math.trunc(tenths));
  const whole = Math.floor(abs / 10);
  const tenth = abs % 10;
  if (tenth === 0) return `${sign}${whole} ${whole === 1 ? "bp" : "bps"}`;
  return `${sign}${whole}.${tenth} bps`;
}

/** A rate in tenths of a bp as a percentage with three places, its exact unit: `8` → `0.008%`. */
export function formatTenthPercent(tenths: number): string {
  const sign = tenths < 0 ? "−" : "";
  const abs = Math.abs(Math.trunc(tenths));
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, "0")}%`;
}

/** A multiplier in bps as a factor: `20000` → `2`, `15000` → `1.5`. */
export function formatMultiplier(bps: number): string {
  const whole = Math.floor(bps / 10_000);
  const part = bps % 10_000;
  return part === 0 ? String(whole) : `${whole}.${String(part).padStart(4, "0").replace(/0+$/, "")}`;
}

/** One band as a row: the notional it covers, in compact dollars, and its rate. */
export interface BandRow {
  span: string;
  rate: string;
}

/** Each band's span of position notional and its rate: `Up to $2.00M`, `$2.00M to $10.0M`, `Above $10.0M`. */
export function bandRows<T extends { up_to: string | null }>(tiers: readonly T[], rate: (tier: T) => string): BandRow[] {
  let lower: string | null = null;
  return tiers.map((tier) => {
    const upper = tier.up_to === null ? null : formatCompactUsd(fixedToNumber(fixedFromWire(tier.up_to)));
    const span = upper === null ? (lower === null ? "Any size" : `Above ${lower}`) : lower === null ? `Up to ${upper}` : `${lower} to ${upper}`;
    lower = upper;
    return { span, rate: rate(tier) };
  });
}

/** A spread band's rate, however written: `0.4 bps`. */
export const spreadRate = (tier: SpreadTier): string => formatTenthBps(tenthBpsOf(tier));

/** A margin band's rate: `1.00%`. */
export const marginRate = (tier: Tier): string => formatRate(tier.bps);

/** What a pending listing notice changes and from when, one sentence per value it names. */
export function describeNotice(notice: ListingNotice): string[] {
  const from = `From ${formatStamp(notice.effective_at)} UTC`;
  const words = (rows: BandRow[]) => rows.map((row) => `${row.rate} ${row.span.charAt(0).toLowerCase()}${row.span.slice(1)}`).join(", ");
  const lines: string[] = [];
  if (notice.spread_tiers !== undefined) lines.push(`${from}, the spread bands may become ${words(bandRows(notice.spread_tiers, spreadRate))}.`);
  if (notice.margin_tiers !== undefined) lines.push(`${from}, the margin bands may become ${words(bandRows(notice.margin_tiers, marginRate))}.`);
  if (notice.markup_bps !== undefined) lines.push(`${from}, the financing markup may become ${notice.markup_bps} bps a year.`);
  return lines;
}
