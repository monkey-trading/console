/** Price bars built from a stream of marks, for the chart only; floats here never mirror engine state. */

import { mulberry32 } from "./prng";

export const TIMEFRAMES = [
  { id: "1m", seconds: 60 },
  { id: "5m", seconds: 300 },
  { id: "15m", seconds: 900 },
  { id: "1h", seconds: 3_600 },
  { id: "1D", seconds: 86_400 },
] as const;

export type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

export const DEFAULT_TIMEFRAME: TimeframeId = "1m";

/**
 * One bar: `time` is the start of its bucket in UTC seconds. `observedHigh`/`observedLow` are the
 * extremes the bucket's actual observations saw — stream ticks or fetched mark samples. The
 * synthetic open a bucket carries from the previous close is not an observation, so a history
 * merge that reopens the bucket at a corrected close can drop it from the extrema without losing
 * a price a tick or mark really printed.
 */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  observedHigh: number;
  observedLow: number;
}

/** The most bars kept per series. */
export const MAX_BARS = 500;

/** The seconds in a timeframe. */
export function secondsOf(id: TimeframeId): number {
  const found = TIMEFRAMES.find((t) => t.id === id);
  if (!found) throw new Error(`unknown timeframe: ${id}`);
  return found.seconds;
}

/**
 * Adds a mark to a series. It extends the bar its time falls in, or opens the next bar at the
 * previous close. A mark older than the last bar's start is ignored, so out-of-order delivery
 * never rewrites history.
 */
export function pushTick(series: readonly Bar[], tMs: number, price: number, seconds: number): Bar[] {
  const time = Math.floor(tMs / 1000 / seconds) * seconds;
  const last = series[series.length - 1];
  if (last && time < last.time) return series.slice();
  if (last && time === last.time) {
    const next = {
      ...last,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
      observedHigh: Math.max(last.observedHigh, price),
      observedLow: Math.min(last.observedLow, price),
    };
    return [...series.slice(0, -1), next];
  }
  const open = last ? last.close : price;
  const bar = {
    time,
    open,
    high: Math.max(open, price),
    low: Math.min(open, price),
    close: price,
    observedHigh: price,
    observedLow: price,
  };
  return [...series, bar].slice(-MAX_BARS);
}

/**
 * A plausible history of `count` bars ending with a bar that closes at `endPrice` in the bucket
 * `endMs` falls in. Seeded, so the server and the browser draw the same bars. `volBpsPerSecond` is
 * the typical move per second.
 */
export function seedBars(seed: number, endMs: number, endPrice: number, seconds: number, volBpsPerSecond: number, count = 240): Bar[] {
  const rand = mulberry32(seed);
  const sigma = (volBpsPerSecond / 10_000) * Math.sqrt(seconds);
  const closes: number[] = [endPrice];
  for (let i = 1; i < count; i++) {
    const step = (rand() + rand() + rand() + rand() - 2) * Math.sqrt(3) * sigma;
    closes.unshift((closes[0] ?? endPrice) / (1 + step));
  }
  const end = Math.floor(endMs / 1000 / seconds) * seconds;
  return closes.map((close, i) => {
    const open = closes[i - 1] ?? close;
    const wick = close * sigma * 0.6 * rand();
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;
    // Every seeded value is a drawn observation, so the observed extrema are the bar's own.
    return { time: end - (closes.length - 1 - i) * seconds, open, close, high, low, observedHigh: high, observedLow: low };
  });
}

/** Bars of `seconds` built from chronological marks, for the chart's history read. */
export function barsFromMarks(marks: readonly { ts: number; mid: number }[], seconds: number): Bar[] {
  let out: Bar[] = [];
  for (const mark of marks) out = pushTick(out, mark.ts, mark.mid, seconds);
  return out;
}

/**
 * Bars to publish when a history fetch lands. `fetched` covers the window up to the fetch's
 * cutoff; `current` may hold newer stream ticks, and `pre` is the series as it stood when the
 * fetch began. Every overlapping bucket keeps the wider of the two observed ranges — sampled
 * marks can miss spikes the ticks saw — and a bucket the fetch has no marks for keeps the
 * stream's bar. The last bucket's close comes from the stream only when it extended the bucket
 * during the fetch (bar objects are immutable, so a changed object at the same time marks ticks
 * past the cutoff); earlier buckets keep the fetched close, the fuller log's sample. Buckets the
 * stream opened after the cutoff follow as they are, the first reopened at the published close:
 * its high and low are the corrected open set against the extrema the bucket's ticks actually
 * observed (`observedHigh`/`observedLow`), never the synthetic open the stream carried forward —
 * that open may lie outside the range its ticks saw, and a tick extreme can coincide with it.
 */
export function mergeFetchedBars(fetched: readonly Bar[], current: readonly Bar[], pre: readonly Bar[] | null): Bar[] {
  const last = fetched[fetched.length - 1];
  if (last === undefined) return current.slice(-MAX_BARS);
  const preAt = pre?.find((bar) => bar.time === last.time);
  const liveByTime = new Map<number, Bar>();
  for (const bar of current) if (bar.time <= last.time) liveByTime.set(bar.time, bar);
  const body = fetched.map((bar) => {
    const live = liveByTime.get(bar.time);
    liveByTime.delete(bar.time);
    if (live === undefined) return bar;
    const wider = {
      ...bar,
      high: Math.max(bar.high, live.high),
      low: Math.min(bar.low, live.low),
      observedHigh: Math.max(bar.observedHigh, live.observedHigh),
      observedLow: Math.min(bar.observedLow, live.observedLow),
    };
    return bar === last && live !== preAt ? { ...wider, close: live.close } : wider;
  });
  const streamOnly = [...liveByTime.values()];
  const mergedLast = body[body.length - 1] ?? last;
  const tail = current.filter((bar) => bar.time > last.time);
  const first = tail[0];
  const rebuilt = first === undefined ? [] : [{
    ...first,
    open: mergedLast.close,
    high: Math.max(mergedLast.close, first.observedHigh),
    low: Math.min(mergedLast.close, first.observedLow),
  }, ...tail.slice(1)];
  return [...body, ...streamOnly, ...rebuilt].sort((a, b) => a.time - b.time).slice(-MAX_BARS);
}

/** A range of bar indices, as the chart reports its visible window; the ends may be fractional. */
export interface LogicalRange {
  from: number;
  to: number;
}

/**
 * The window to show after the oldest bar rolled off, so the view keeps its width and its offset
 * from the newest bar. A view that shows the newest bar follows it (its indices move with the
 * count); any other view stays on the same bars, which moved down the index by the bars dropped.
 * It is `null` when the newest bar the old view held is gone, and the chart keeps its own window.
 */
export function rolledRange(range: LogicalRange, previousCount: number, previousLastTime: number, bars: readonly Bar[]): LogicalRange | null {
  const previousLast = previousCount - 1;
  let shift = bars.length - previousCount;
  if (range.to < previousLast) {
    const moved = bars.findIndex((b) => b.time === previousLastTime);
    if (moved < 0) return null;
    shift = moved - previousLast;
  }
  return { from: range.from + shift, to: range.to + shift };
}
