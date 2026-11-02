/** The position maps' figures: the close-out bands over the candles, the profit density, and the house's result at a price move. */

import { bpsOf, fixedFromWire, fixedToNumber, type Fixed } from "./fixed";
import { formatCompactUsd } from "./chart-format";
import { formatMovePercent } from "./format";
import type { PositionsView, ProfitBucketView, SideCounts } from "./engine/stats-types";

/** The notional the node's scan puts at a close-out price range, by side. Floats, for drawing alone. */
export interface Band {
  fromPrice: number;
  toPrice: number;
  longUsd: number;
  shortUsd: number;
  longCount: number;
  shortCount: number;
}

const usdOf = (counts: Pick<SideCounts, "long_usd" | "short_usd">): number => fixedToNumber(fixedFromWire(counts.long_usd)) + fixedToNumber(fixedFromWire(counts.short_usd));

/** A band's notional on both sides. */
export const bandUsd = (band: Band): number => band.longUsd + band.shortUsd;

/** The close-out buckets that hold positions and have prices, lowest price first. */
export function closeoutBands(view: PositionsView): Band[] {
  return view.closeout.flatMap((bucket) => {
    if (bucket.from_price === null || bucket.to_price === null || usdOf(bucket) === 0) return [];
    const a = fixedToNumber(fixedFromWire(bucket.from_price));
    const b = fixedToNumber(fixedFromWire(bucket.to_price));
    return [{
      fromPrice: Math.min(a, b),
      toPrice: Math.max(a, b),
      longUsd: fixedToNumber(fixedFromWire(bucket.long_usd)),
      shortUsd: fixedToNumber(fixedFromWire(bucket.short_usd)),
      longCount: bucket.long_count,
      shortCount: bucket.short_count,
    }];
  }).sort((x, y) => x.fromPrice - y.fromPrice);
}

/** The bands that touch the range of `rangeBps` around `mark`. */
export function bandsWithin(bands: readonly Band[], mark: number, rangeBps: number): Band[] {
  const low = mark * (1 - rangeBps / 10_000);
  const high = mark * (1 + rangeBps / 10_000);
  return bands.filter((band) => band.toPrice > low && band.fromPrice < high);
}

/** The close-out map's price ranges around the mark, in basis points: the choices up to the node's own range. */
const RANGE_STEPS_BPS = [100, 200, 500, 1_000, 1_500, 2_000] as const;
/** The range the map opens on while the node has no band, or none that needs more. */
export const DEFAULT_RANGE_BPS = 500;

/** The ranges to offer for a node that scans `nodeRangeBps` around the mark: the steps it covers, and its own range if no step is it. */
export function offeredRanges(nodeRangeBps: number): number[] {
  const steps: number[] = RANGE_STEPS_BPS.filter((bps) => bps <= nodeRangeBps);
  return steps.includes(nodeRangeBps) || nodeRangeBps <= 0 ? steps : [...steps, nodeRangeBps];
}

/** How far from the mark the farthest band that holds positions and has prices reaches, in basis points; null when there is none. */
function farthestBandBps(view: PositionsView): number | null {
  const reaches = view.closeout
    .filter((bucket) => bucket.from_price !== null && bucket.to_price !== null && usdOf(bucket) > 0)
    .map((bucket) => Math.max(Math.abs(bucket.from_bps), Math.abs(bucket.to_bps)));
  return reaches.length === 0 ? null : Math.max(...reaches);
}

/**
 * The range the map should open on for `view`: the narrowest offered range that holds every
 * non-empty band. With no band, the default (or the node's own range when that is narrower); the
 * node's whole range when bands reach past every narrower step.
 */
export function neededRangeBps(view: PositionsView): number {
  const offered = offeredRanges(view.closeout_range_bps);
  const widest = offered[offered.length - 1] ?? DEFAULT_RANGE_BPS;
  const reach = farthestBandBps(view) ?? DEFAULT_RANGE_BPS;
  return offered.find((bps) => bps >= reach) ?? widest;
}

/**
 * The range to show once the market's first answer picked `held`: it only widens, so a refresh that
 * brings a band the held range hides shows it, and one that empties the map leaves the range alone.
 */
export const settledRangeBps = (held: number | null, needed: number): number => (held === null ? needed : Math.max(held, needed));

/** Why the map shows no band within `rangeBps`, and where the positions are instead; null when it shows a band or has no mark. */
export function emptyMapNote(view: PositionsView, rangeBps: number): string | null {
  if (view.mark === null || bandsWithin(closeoutBands(view), fixedToNumber(fixedFromWire(view.mark)), rangeBps).length > 0) return null;
  const head = `No positions close out within ±${rangeBps / 100}% of the mark.`;
  const reach = farthestBandBps(view);
  if (reach !== null) return `${head} The nearest bands lie further out: choose a wider range.`;
  const beyond = usdOf(view.beyond_range);
  return beyond > 0 ? `${head} ${formatCompactUsd(beyond)} closes out beyond the node's ±${view.closeout_range_bps / 100}% range.` : head;
}

/** A band's colour weight from 0 to 1: the square root of its share of the heaviest, so small bands still show. */
export function intensity(usd: number, maxUsd: number): number {
  return maxUsd <= 0 ? 0 : Math.sqrt(Math.min(1, Math.max(0, usd / maxUsd)));
}

/** One row of the position map: the notional at one profit or loss range, by side. */
export interface DensityRow {
  label: string;
  long: number;
  short: number;
  longCount: number;
  shortCount: number;
}

function labelOf(bucket: ProfitBucketView): string {
  const { from_bps: from, to_bps: to } = bucket;
  if (from === null && to !== null) return `below ${formatMovePercent(to)}`;
  if (to === null && from !== null) return `above ${formatMovePercent(from)}`;
  if (from === null || to === null) return "all";
  return `${formatMovePercent(from)} to ${formatMovePercent(to)}`;
}

/** The profit buckets that hold positions, most profit first, so the map reads as a chart with gains above losses. */
export function densityRows(view: PositionsView): DensityRow[] {
  return view.profit
    .map((bucket) => ({ order: bucket.from_bps ?? Number.NEGATIVE_INFINITY, row: { label: labelOf(bucket), long: fixedToNumber(fixedFromWire(bucket.long_usd)), short: fixedToNumber(fixedFromWire(bucket.short_usd)), longCount: bucket.long_count, shortCount: bucket.short_count } }))
    .filter(({ row }) => row.long + row.short > 0)
    .sort((a, b) => b.order - a.order)
    .map(({ row }) => row);
}

/**
 * The house's result at a price move of `moveBps` from now, before any close-out: the clients' net
 * notional (long less short) gains what the price gains and the house takes the other side. Linear,
 * so it stays an estimate; closing positions out would bend it.
 */
export function houseResultAt(net: Fixed, moveBps: number): Fixed {
  return -bpsOf(net, moveBps);
}

/** The point of the house result curve across `±rangeBps` in `stepBps` steps. */
export function resultCurve(net: Fixed, rangeBps: number, stepBps: number): { bps: number; usd: number }[] {
  const out: { bps: number; usd: number }[] = [];
  for (let bps = -rangeBps; bps <= rangeBps; bps += stepBps) out.push({ bps, usd: fixedToNumber(houseResultAt(net, bps)) });
  return out;
}
