/**
 * One MONKEY chart's data: the series it plots read for a timeframe, kept bounded, and refreshed
 * while its Live switch is on. A feed is its own small store, so a chart redraws only when its own
 * data changes, never on the console's stream.
 */

import type { SeriesMetric, SeriesPage, StatsReads } from "../engine/stats-types";
import { failed, LOADING, plotValue, ready, type Read } from "./figures";
import { timeframe, type TimeframeId } from "./timeframes";

/** Most points a line holds: a window larger than this keeps its newest. */
export const MAX_POINTS = 2_000;
/** Most pages one load reads, and entries per page. */
const MAX_PAGES = 4;
const PAGE_LIMIT = 1_000;
/** Entries a live read asks for: the open bucket and the few that followed it. */
const LIVE_LIMIT = 50;
/** How far past the node's clock a read's upper bound sits, so the open bucket is always inside it. */
const DAY_MS = 86_400_000;

export interface ChartPoint {
  /** The bucket's start, in milliseconds. */
  ms: number;
  value: number;
}

export interface ChartData {
  /** The timeframe these points were read for, which can lag the feed's while a new window loads. */
  timeframe: TimeframeId;
  /** Each metric's points, oldest first. */
  lines: Readonly<Record<string, readonly ChartPoint[]>>;
  /** The last bucket's value as the node wrote it, per metric, for a figure that must stay exact. */
  latest: Readonly<Record<string, string | null>>;
  /** Each metric's unit as the node names it, which says how its values are written. */
  units: Readonly<Record<string, string>>;
  /** Where the node's data for the first metric begins, and whether that is the log's first command. */
  begins_ms: number | null;
  from_genesis: boolean;
  retained_from_ms: number | null;
}

export interface FeedState {
  timeframe: TimeframeId;
  live: boolean;
  read: Read<ChartData>;
}

function textOf(entry: SeriesPage["entries"][number]): string {
  return "close" in entry ? entry.close : entry.value;
}

/** `page`'s entries as points, skipping any whose value this page cannot plot. */
function pointsOf(page: SeriesPage): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (const entry of page.entries) {
    const value = plotValue(textOf(entry), page.unit);
    if (value !== null) points.push({ ms: entry.ts, value });
  }
  return points;
}

/**
 * `fresh` laid over `held`: a bucket read again replaces its earlier read, later buckets append,
 * buckets that start before `floorMs` drop out, and only the newest `MAX_POINTS` stay.
 */
export function mergePoints(held: readonly ChartPoint[], fresh: readonly ChartPoint[], floorMs = Number.NEGATIVE_INFINITY): ChartPoint[] {
  const first = fresh[0];
  const merged = (first === undefined ? [...held] : [...held.filter((point) => point.ms < first.ms), ...fresh]).filter((point) => point.ms >= floorMs);
  return merged.length > MAX_POINTS ? merged.slice(merged.length - MAX_POINTS) : merged;
}

export class ChartFeed {
  private state: FeedState;
  private readonly listeners = new Set<() => void>();
  /** Counts loads, so an answer a newer load or a close has overtaken is dropped. */
  private generation = 0;
  private reading = false;

  constructor(
    readonly metrics: readonly SeriesMetric[],
    private readonly reads: StatsReads,
    private readonly nowMs: () => number,
    /** Whether the page that owns this chart is reading; nothing is read before it starts or after it stops. */
    private readonly active: () => boolean,
    initial: TimeframeId,
  ) {
    this.state = { timeframe: initial, live: false, read: LOADING };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): FeedState => this.state;

  private set(partial: Partial<FeedState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  /** Changes the window and reads it afresh; resolves once that read has answered. */
  setTimeframe(id: TimeframeId): Promise<void> {
    if (id === this.state.timeframe) return Promise.resolve();
    // The chart keeps what it holds until the new window answers.
    this.set({ timeframe: id, read: this.state.read.value === null ? LOADING : { status: "loading", value: this.state.read.value, message: null } });
    return this.load();
  }

  setLive(live: boolean): void {
    this.set({ live });
  }

  /** Stands down any read in flight and forgets what was read; the page closing calls it. */
  close(): void {
    this.generation += 1;
    this.reading = false;
    this.set({ read: LOADING });
  }

  private async readMetric(metric: SeriesMetric, fromMs: number, limit: number, pages: number, current: () => boolean): Promise<{ page: SeriesPage; points: ChartPoint[] }> {
    const { resolution } = timeframe(this.state.timeframe);
    let page = await this.reads.series({ metric, market: null, resolution, fromMs, toMs: this.nowMs() + DAY_MS, limit });
    let points = pointsOf(page);
    for (let read = 1; page.next !== null && read < pages && current(); read += 1) {
      page = await this.reads.series({ metric, market: null, resolution, fromMs: page.next, toMs: this.nowMs() + DAY_MS, limit });
      points = mergePoints(points, pointsOf(page));
    }
    return { page, points };
  }

  /** Reads the whole window. A failure keeps what the chart held and shows on the chart, with no toast. */
  async load(): Promise<void> {
    if (!this.active()) return;
    const stamp = ++this.generation;
    const frame = timeframe(this.state.timeframe);
    const now = this.nowMs();
    const from = frame.windowMs === null ? 0 : Math.max(0, now - frame.windowMs);
    this.reading = true;
    try {
      const results = await Promise.all(this.metrics.map((metric) => this.readMetric(metric, from, PAGE_LIMIT, MAX_PAGES, () => stamp === this.generation && this.active())));
      if (stamp !== this.generation) return;
      const lines: Record<string, ChartPoint[]> = {};
      const latest: Record<string, string | null> = {};
      const units: Record<string, string> = {};
      this.metrics.forEach((metric, index) => {
        const result = results[index];
        lines[metric] = result?.points ?? [];
        units[metric] = result?.page.unit ?? "";
        const last = result?.page.entries[result.page.entries.length - 1];
        latest[metric] = last === undefined ? null : textOf(last);
      });
      const meta = results[0]?.page;
      this.set({ read: ready({ timeframe: frame.id, lines, latest, units, begins_ms: meta?.begins_ms ?? null, from_genesis: meta?.from_genesis ?? true, retained_from_ms: meta?.retained_from_ms ?? null }) });
    } catch (error) {
      if (stamp === this.generation) this.set({ read: failed(error, this.state.read.value) });
    } finally {
      if (stamp === this.generation) this.reading = false;
    }
  }

  /** Reads the newest buckets and lays them over the held ones; one at a time, and nothing before the first load has answered. */
  async tickLive(): Promise<void> {
    const held = this.state.read.value;
    if (!this.state.live || this.reading || !this.active()) return;
    // A first read that failed has nothing to refresh: try it whole again. A node without the route is left alone.
    if (held === null) return this.state.read.status === "failed" ? this.load() : undefined;
    // The held points are another window's, as after a timeframe change whose read failed: read this one whole.
    if (held.timeframe !== this.state.timeframe) return this.load();
    const stamp = this.generation;
    const frame = timeframe(this.state.timeframe);
    const floorMs = frame.windowMs === null ? undefined : this.nowMs() - frame.windowMs - frame.bucketMs;
    this.reading = true;
    try {
      const results = await Promise.all(this.metrics.map((metric) => this.readMetric(metric, held.lines[metric]?.at(-1)?.ms ?? Math.max(0, floorMs ?? 0), LIVE_LIMIT, 1, () => true)));
      const current = this.state.read.value;
      if (stamp !== this.generation || current === null) return;
      const lines: Record<string, readonly ChartPoint[]> = {};
      const latest: Record<string, string | null> = { ...current.latest };
      this.metrics.forEach((metric, index) => {
        const result = results[index];
        lines[metric] = mergePoints(current.lines[metric] ?? [], result?.points ?? [], floorMs);
        // Only a bucket inside the window is the latest value; an older one a read of the record's start returned is not.
        const last = result?.page.entries.filter((entry) => floorMs === undefined || entry.ts >= floorMs).at(-1);
        if (last !== undefined) latest[metric] = textOf(last);
        // No bucket left in the window means no latest value, not the one that aged out of it.
        else if ((lines[metric] ?? []).length === 0) latest[metric] = null;
      });
      this.set({ read: ready({ ...current, lines, latest }) });
    } catch (error) {
      // A live refresh that fails leaves the chart as it was; the next tick tries again.
      if (stamp === this.generation) this.set({ read: { ...this.state.read, message: error instanceof Error ? error.message : "The read failed." } });
    } finally {
      if (stamp === this.generation) this.reading = false;
    }
  }
}
