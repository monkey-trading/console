/** The scales, ticks and thinning of the console's own SVG chart (`components/charts/Chart.tsx`): pure numbers in, numbers out, no DOM. */

import { minimumSpanRange, nonNegativeRange } from "./chart-format";

/** A plotted point: Unix milliseconds and a value in dollars, units or a ratio. A float, for the chart alone. */
export interface ChartPoint {
  ts: number;
  value: number;
}

/** A value axis: the range the plot shows. */
export interface Domain {
  min: number;
  max: number;
}

/** Share of the range added above and below the values, so a line at an extreme is not drawn on the edge. */
const PAD = 0.06;

/**
 * The range a value axis shows for `values`. A series that cannot go below zero (`nonNegative`)
 * never gets an axis that starts below it: flat at zero it fits $0 to $1, never -$0.50 to $0.50.
 * `zeroBase` keeps zero in view, for bars, which rise from it. A flat series fits a range of its own
 * (`minimumSpanRange`), so its ticks print distinct labels. No values at all show $0 to $1.
 */
export function valueDomain(values: readonly number[], nonNegative: boolean, zeroBase = false): Domain {
  if (values.length === 0) return { min: 0, max: 1 };
  const low = Math.min(...values, ...(zeroBase ? [0] : []));
  const high = Math.max(...values, ...(zeroBase ? [0] : []));
  const fitted = nonNegative ? nonNegativeRange(low, high) : (minimumSpanRange(low, high) ?? { min: low, max: high });
  const pad = (fitted.max - fitted.min) * PAD;
  // Bars rise from their baseline: no air under it, or it would float.
  const min = nonNegative ? Math.max(0, fitted.min - pad) : zeroBase && fitted.min === 0 ? 0 : fitted.min - pad;
  return { min, max: fitted.max + pad };
}

/** Round tick values inside `domain`, about `count` of them, at 1, 2, 2.5 or 5 times a power of ten. */
export function niceTicks(domain: Domain, count: number): number[] {
  const span = domain.max - domain.min;
  if (!(span > 0) || count < 1) return [];
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
  const ticks: number[] = [];
  for (let tick = Math.ceil(domain.min / step) * step; tick <= domain.max + step * 1e-9; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return ticks;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TIME_STEPS = [MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 7 * DAY, 30 * DAY] as const;

/** A time tick: when, and whether it opens a larger unit (the hour, or the day) so its label can stand out. */
export interface TimeTick {
  ts: number;
  major: boolean;
}

/** Ticks of the time axis from `from` to `to` (UTC), at most `count`, on a round step; the step is returned with them so labels know their precision. */
export function timeTicks(from: number, to: number, count: number): { step: number; ticks: TimeTick[] } {
  const span = to - from;
  const step = TIME_STEPS.find((candidate) => span / candidate <= count) ?? DAY * 30;
  const ticks: TimeTick[] = [];
  if (span > 0 && count >= 1) {
    const major = step >= DAY ? DAY : step >= HOUR ? DAY : HOUR;
    for (let ts = Math.ceil(from / step) * step; ts <= to; ts += step) ticks.push({ ts, major: ts % major === 0 });
  }
  return { step, ticks };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** A time-axis label: the day from a day's step up, and `HH:MM` below it, with the day on the tick that opens one. UTC. */
export function timeLabel(tick: TimeTick, step: number): string {
  const date = new Date(tick.ts);
  const day = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? "?"}`;
  if (step >= DAY || (tick.major && date.getUTCHours() === 0 && date.getUTCMinutes() === 0)) return day;
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

/**
 * `points` thinned to what `columns` pixel columns can show: from each column the first, last,
 * lowest and highest point, in time order, so no peak or dip is lost and a long series stays as
 * smooth to draw as a short one. A series that already fits is returned as it is.
 */
export function thin(points: readonly ChartPoint[], columns: number): readonly ChartPoint[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || columns < 1 || points.length <= columns * 4) return points;
  const width = (last.ts - first.ts) / columns || 1;
  const kept: ChartPoint[] = [];
  let start = 0;
  while (start < points.length) {
    const column = Math.min(columns - 1, Math.floor(((points[start]?.ts ?? 0) - first.ts) / width));
    let end = start;
    while (end + 1 < points.length && Math.min(columns - 1, Math.floor(((points[end + 1]?.ts ?? 0) - first.ts) / width)) === column) end += 1;
    const bucket = points.slice(start, end + 1);
    const low = bucket.reduce((a, b) => (b.value < a.value ? b : a));
    const high = bucket.reduce((a, b) => (b.value > a.value ? b : a));
    const picked = new Set([bucket[0], low, high, bucket[bucket.length - 1]]);
    for (const point of bucket) if (picked.has(point)) kept.push(point);
    start = end + 1;
  }
  return kept;
}

/** The index of the point at or nearest `ts` in time order, or -1 for none. */
export function nearestIndex(points: readonly ChartPoint[], ts: number): number {
  if (points.length === 0) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((points[mid]?.ts ?? 0) < ts) lo = mid + 1;
    else hi = mid;
  }
  const after = points[lo];
  const before = points[lo - 1];
  return before !== undefined && after !== undefined && ts - before.ts <= after.ts - ts ? lo - 1 : lo;
}

/** A marker placed on a line: where, and what it says. */
export interface Mark {
  ts: number;
  text: string;
}

/** `marks` that sit on a point of `line`: each moves to the first point at or after its time, and one before the line's first point, or after its last, is dropped. */
export function placeMarks(marks: readonly Mark[], line: readonly ChartPoint[]): Mark[] {
  const first = line[0];
  if (first === undefined) return [];
  return marks.flatMap((mark) => {
    if (mark.ts < first.ts) return [];
    const at = line.find((point) => point.ts >= mark.ts);
    return at === undefined ? [] : [{ ts: at.ts, text: mark.text }];
  });
}

/** The value of `points` at `ts`: the nearest point's, or null for a series with none within `within` milliseconds. */
export function valueAt(points: readonly ChartPoint[], ts: number, within: number): number | null {
  const i = nearestIndex(points, ts);
  const point = points[i];
  return point === undefined || Math.abs(point.ts - ts) > within ? null : point.value;
}

/** Keeps value tags apart: each tag's y, moved so none is closer than `gap` to the next and none leaves `[top, bottom]`. Input order is kept. */
export function spreadTags(ys: readonly number[], gap: number, top: number, bottom: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((tag) => ({ ...tag }));
  placed.forEach((tag, k) => {
    const above = placed[k - 1];
    tag.y = Math.max(tag.y, top, above === undefined ? top : above.y + gap);
  });
  for (let k = placed.length - 1; k >= 0; k -= 1) {
    const tag = placed[k];
    const below = placed[k + 1];
    if (tag !== undefined) tag.y = Math.min(tag.y, bottom, below === undefined ? bottom : below.y - gap);
  }
  const out = ys.map(() => 0);
  for (const tag of placed) out[tag.i] = tag.y;
  return out;
}
