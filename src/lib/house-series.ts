/** The dashboard's series reads: the timeframes a chart offers, the window each asks for, and the points a page folds into. */

import { fixedFromWire, fixedToNumber } from "./fixed";
import type { MarketId } from "./engine/types";
import type { LevelEntry, SeriesMetric, SeriesPage, SeriesQuery, SeriesResolution, ValueEntry } from "./engine/stats-types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The most entries one read asks for: the node's own page cap. */
export const MAX_POINTS = 2_000;

const BUCKET_MS = { "1m": MINUTE_MS, "1h": HOUR_MS, "1d": DAY_MS } as const satisfies Record<SeriesResolution, number>;

/** The timeframes a chart offers: how far back it reads, at the finest resolution that fits one page. */
export const RANGES = [
  { id: "1h", label: "1H", spanMs: HOUR_MS, resolution: "1m" },
  { id: "6h", label: "6H", spanMs: 6 * HOUR_MS, resolution: "1m" },
  { id: "1d", label: "1D", spanMs: DAY_MS, resolution: "1m" },
  { id: "7d", label: "7D", spanMs: 7 * DAY_MS, resolution: "1h" },
  { id: "30d", label: "30D", spanMs: 30 * DAY_MS, resolution: "1h" },
  { id: "1y", label: "1Y", spanMs: 365 * DAY_MS, resolution: "1d" },
] as const satisfies readonly { id: string; label: string; spanMs: number; resolution: SeriesResolution }[];

export type RangeId = (typeof RANGES)[number]["id"];
export const DEFAULT_RANGE: RangeId = "1d";

/** The range's definition; the ids are a closed set, so a miss is a bug. */
export function rangeOf(id: RangeId): (typeof RANGES)[number] {
  const range = RANGES.find((r) => r.id === id);
  if (range === undefined) throw new Error(`unknown range ${id}`);
  return range;
}

/** The read for `metric` over the range ending at the node's time `nowMs`; buckets are aligned to their width. */
export function seriesQuery(metric: SeriesMetric, market: MarketId | null, range: RangeId, nowMs: number): SeriesQuery {
  const { spanMs, resolution } = rangeOf(range);
  const width = BUCKET_MS[resolution];
  return { metric, market, resolution, fromMs: Math.floor((nowMs - spanMs) / width) * width, toMs: nowMs, limit: Math.min(MAX_POINTS, Math.ceil(spanMs / width) + 2) };
}

/** One bucket as a point: a level's close, or a flow's value. A float, for the chart alone. */
export interface SeriesPoint {
  ts: number;
  value: number;
}

/** A series as held: its points and where the node's data for it begins. */
export interface SeriesData {
  points: readonly SeriesPoint[];
  beginsMs: number | null;
  fromGenesis: boolean;
  retainedFromMs: number | null;
  resolution: SeriesResolution;
}

/**
 * The points of one page: a level's close or a flow's value.
 * Error cases:
 * - an amount is not a decimal: the node signed it, so the engine never sends one and the read fails rather than plotting a guess
 */
export function pointsOf(entries: readonly (LevelEntry | ValueEntry)[]): SeriesPoint[] {
  return entries.map((entry) => ({ ts: entry.ts, value: fixedToNumber(fixedFromWire("close" in entry ? entry.close : entry.value)) }));
}

/**
 * The series after `page`: a first read replaces it, a follow-up read (from the last bucket on)
 * replaces that bucket and adds the newer ones, and buckets before `windowFromMs` or past the
 * point cap fall away, so what is held stays bounded however long the page stays open.
 */
export function foldSeries(prev: SeriesData | null, page: SeriesPage, windowFromMs: number): SeriesData {
  const fresh = pointsOf(page.entries);
  const first = fresh[0];
  const kept = prev === null || first === undefined ? [] : prev.points.filter((p) => p.ts < first.ts);
  const points = [...kept, ...fresh].filter((p) => p.ts >= windowFromMs).slice(-MAX_POINTS);
  return { points, beginsMs: page.begins_ms, fromGenesis: page.from_genesis, retainedFromMs: page.retained_from_ms, resolution: page.resolution };
}

/** Where a chart's data begins and why nothing earlier is shown, as the node's answer says. */
export interface Begins {
  ms: number;
  reason: "genesis" | "recovery" | "retention";
}

/**
 * The time a series' data begins: the record's start, unless the node's retention for this
 * resolution has pruned later than that, in which case the retention edge is the beginning.
 */
export function beginsOf(data: SeriesData): Begins | null {
  const { beginsMs, retainedFromMs } = data;
  if (retainedFromMs !== null && (beginsMs === null || retainedFromMs > beginsMs)) return { ms: retainedFromMs, reason: "retention" };
  return beginsMs === null ? null : { ms: beginsMs, reason: data.fromGenesis ? "genesis" : "recovery" };
}

/** The sentence under a chart that says where its data begins; `stamp` formats a time. */
export function beginsText(data: SeriesData | null, stamp: (ms: number) => string): string {
  const begins = data === null ? null : beginsOf(data);
  if (begins === null) return "The node has recorded nothing for this chart yet.";
  const why = { genesis: "from the log's first command", recovery: "since the node last recovered from a snapshot, so earlier history is not in its answer", retention: "the oldest this node keeps at this resolution" }[begins.reason];
  return `Data begins ${stamp(begins.ms)} UTC, ${why}.`;
}

/** The buckets a follow-up read asks for beyond the last one held. */
export const FOLLOW_UP_LIMIT = 200;

/**
 * The read to make when `previous` is held: from its last bucket when that is close enough for one
 * page to reach `now`, and the whole window otherwise, so a feed left behind never reports itself
 * current on a partial catch-up.
 */
export function nextQuery(full: SeriesQuery, previous: SeriesData | null): SeriesQuery {
  const last = previous?.points[previous.points.length - 1];
  if (last === undefined) return full;
  const width = BUCKET_MS[full.resolution];
  return (full.toMs - last.ts) / width >= FOLLOW_UP_LIMIT - 2 ? full : { ...full, fromMs: last.ts, limit: FOLLOW_UP_LIMIT };
}

/**
 * The newest `limit` buckets of several series as table rows, newest first: one row for each bucket
 * time any series holds, each series' value read by that time, or null where it has none. Feeds
 * refresh on their own timers, so the series can end at different buckets.
 */
export function tableRows(series: readonly (readonly SeriesPoint[])[], limit: number): { ts: number; values: (number | null)[] }[] {
  const byTime = series.map((points) => new Map(points.map((point) => [point.ts, point.value])));
  const times = [...new Set(series.flatMap((points) => points.map((point) => point.ts)))].sort((a, b) => b - a).slice(0, limit);
  return times.map((ts) => ({ ts, values: byTime.map((values) => values.get(ts) ?? null) }));
}
