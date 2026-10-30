/** Tests for the adapter that turns marks into the chart's bars. */

import { describe, expect, it } from "vitest";

import { type Bar, barsFromMarks, MAX_BARS, mergeFetchedBars, pushTick, rolledRange, secondsOf, seedBars, TIMEFRAMES } from "./bars";

const MIN = 60;
const at = (seconds: number) => seconds * 1000;

describe("pushTick", () => {
  it("opens a bar at the first mark and widens it with later marks in the same bucket", () => {
    let bars = pushTick([], at(120), 100, MIN);
    bars = pushTick(bars, at(130), 103, MIN);
    bars = pushTick(bars, at(150), 98, MIN);
    bars = pushTick(bars, at(179), 101, MIN);
    expect(bars).toEqual([{ time: 120, open: 100, high: 103, low: 98, close: 101 }]);
  });

  it("opens the next bar at the previous close, and fills no empty bucket for a gap", () => {
    let bars = pushTick([], at(120), 100, MIN);
    bars = pushTick(bars, at(125), 104, MIN);
    bars = pushTick(bars, at(125 + 5 * MIN), 90, MIN);
    expect(bars).toHaveLength(2);
    expect(bars[1]).toEqual({ time: 420, open: 104, high: 104, low: 90, close: 90 });
  });

  it("ignores a mark older than the last bar and does not mutate its input", () => {
    const first = pushTick([], at(300), 100, MIN);
    const frozen = JSON.stringify(first);
    expect(pushTick(first, at(100), 50, MIN)).toEqual(first);
    pushTick(first, at(310), 120, MIN);
    expect(JSON.stringify(first)).toBe(frozen);
  });

  it("aligns buckets to each timeframe and bounds the series", () => {
    const hour = secondsOf("1h");
    expect(pushTick([], at(3_700), 1, hour)[0]?.time).toBe(3_600);
    expect(pushTick([], at(90_000), 1, secondsOf("1D"))[0]?.time).toBe(86_400);
    let bars = pushTick([], 0, 1, MIN);
    for (let i = 1; i < MAX_BARS + 20; i++) bars = pushTick(bars, at(i * MIN), 1 + i, MIN);
    expect(bars).toHaveLength(MAX_BARS);
    expect(TIMEFRAMES.map((t) => t.id)).toEqual(["1m", "5m", "15m", "1h", "1D"]);
  });
});

describe("seedBars", () => {
  it("is deterministic, ends at the given price in the current bucket, and has well-formed bars", () => {
    const a = seedBars(7, at(1_000_000), 100, 300, 1.5);
    expect(seedBars(7, at(1_000_000), 100, 300, 1.5)).toEqual(a);
    expect(a).toHaveLength(240);
    expect(a[a.length - 1]).toMatchObject({ time: 999_900, close: 100 });
    expect(a.every((b, i) => b.low <= Math.min(b.open, b.close) && b.high >= Math.max(b.open, b.close) && (i === 0 || b.time - (a[i - 1]?.time ?? 0) === 300))).toBe(true);
  });

  it("lets a live mark continue the last seeded bar", () => {
    const seeded = seedBars(7, at(1_000_000), 100, 300, 1.5);
    const live = pushTick(seeded, at(1_000_020), 101, 300);
    expect(live).toHaveLength(seeded.length);
    expect(live[live.length - 1]?.close).toBe(101);
  });
});

describe("barsFromMarks", () => {
  it("replays chronological marks into bars of the timeframe, ignoring out-of-order tails", () => {
    const marks = [
      { ts: at(120), mid: 100 },
      { ts: at(130), mid: 103 },
      { ts: at(60), mid: 50 }, // before the first bar: ignored
      { ts: at(150), mid: 98 },
    ];
    expect(barsFromMarks(marks, MIN)).toEqual([{ time: 120, open: 100, high: 103, low: 98, close: 98 }]);
    expect(barsFromMarks([{ ts: at(125), mid: 100 }], 300)).toEqual([{ time: 0, open: 100, high: 100, low: 100, close: 100 }]);
  });
});

describe("mergeFetchedBars", () => {
  const bar = (time: number, o: number, h: number, l: number, c: number): Bar => ({ time, open: o, high: h, low: l, close: c });

  it("keeps the current series when the fetch found no marks", () => {
    const current = [bar(60, 1, 1, 1, 1)];
    expect(mergeFetchedBars([], current, null)).toEqual(current);
  });

  it("appends the buckets the stream opened after the fetched window, and takes the shared bucket's newer range", () => {
    const lastFetched = bar(60, 105, 106, 104, 106);
    const fetched = [bar(0, 100, 110, 90, 105), lastFetched];
    const current = [bar(60, 105, 120, 100, 118), bar(120, 118, 130, 115, 116)];
    expect(mergeFetchedBars(fetched, current, [lastFetched])).toEqual([bar(0, 100, 110, 90, 105), bar(60, 105, 120, 100, 118), bar(120, 118, 130, 115, 116)]);
  });

  it("keeps the fetched close when the shared bucket gained no ticks during the fetch", () => {
    const stale = bar(60, 100, 105, 95, 100); // what the stream held when the fetch began, and still holds
    const lastFetched = bar(60, 100, 110, 90, 108); // the log's fuller picture of the same bucket
    const merged = mergeFetchedBars([bar(0, 1, 1, 1, 1), lastFetched], [stale, bar(120, 108, 109, 107, 107)], [stale]);
    expect(merged[1]).toEqual(lastFetched);
  });

  it("drops current buckets inside the fetched window and bounds the series", () => {
    const fetched = Array.from({ length: MAX_BARS }, (_, i) => bar(i * MIN, 1, 1, 1, 1));
    const current = [bar(0, 9, 9, 9, 9), bar((MAX_BARS - 1) * MIN, 1, 2, 1, 2), bar(MAX_BARS * MIN, 3, 3, 3, 3)];
    const merged = mergeFetchedBars(fetched, current, null);
    expect(merged).toHaveLength(MAX_BARS);
    expect(merged[0]?.time).toBe(MIN);
    expect(merged[MAX_BARS - 2]).toEqual(bar((MAX_BARS - 1) * MIN, 1, 2, 1, 2));
    expect(merged[MAX_BARS - 1]).toEqual(bar(MAX_BARS * MIN, 3, 3, 3, 3));
  });
});

describe("rolledRange", () => {
  const series = (firstTime: number, count: number): Bar[] =>
    Array.from({ length: count }, (_, i) => ({ time: firstTime + i * MIN, open: 1, high: 1, low: 1, close: 1 }));
  const before = series(0, MAX_BARS);
  const lastTime = before[MAX_BARS - 1]?.time ?? 0;
  // The oldest bar rolled off and one opened: the same count, every bar one index lower.
  const after = series(MIN, MAX_BARS);

  it("keeps a panned view on the same bars, so its offset from the newest bar grows by the bars dropped", () => {
    expect(rolledRange({ from: 300, to: 400 }, MAX_BARS, lastTime, after)).toEqual({ from: 299, to: 399 });
  });

  it("keeps the offset right of the newest bar when the view shows it", () => {
    expect(rolledRange({ from: 404, to: 524 }, MAX_BARS, lastTime, after)).toEqual({ from: 404, to: 524 });
    expect(rolledRange({ from: 399, to: 499 }, MAX_BARS, lastTime, after)).toEqual({ from: 399, to: 499 });
  });

  it("follows the newest bar while the series is still growing", () => {
    expect(rolledRange({ from: 50, to: 154 }, 150, 149 * MIN, series(0, 151))).toEqual({ from: 51, to: 155 });
  });

  it("follows each bar that opened when several rolled in at once", () => {
    expect(rolledRange({ from: 300, to: 400 }, MAX_BARS, lastTime, series(2 * MIN, MAX_BARS))).toEqual({ from: 298, to: 398 });
  });

  it("gives nothing when the bar the view ended at is gone", () => {
    expect(rolledRange({ from: 300, to: 400 }, MAX_BARS, lastTime, series(1_000 * MIN, MAX_BARS))).toBeNull();
  });
});
