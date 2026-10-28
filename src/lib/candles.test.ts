/** Tests for the chart's candles. */

import { describe, expect, it } from "vitest";

import { CANDLE_MS, MAX_CANDLES, pushMark, seedCandles } from "./candles";

describe("pushMark", () => {
  it("extends the open candle and starts the next at the previous close", () => {
    let series = pushMark([], 10_000, 100);
    series = pushMark(series, 11_000, 103);
    series = pushMark(series, 12_000, 98);
    expect(series).toEqual([{ t: 10_000, open: 100, high: 103, low: 98, close: 98 }]);
    series = pushMark(series, 10_000 + CANDLE_MS, 99);
    expect(series[1]).toEqual({ t: 10_000 + CANDLE_MS, open: 98, high: 99, low: 98, close: 99 });
  });

  it("keeps a bounded series", () => {
    let series = pushMark([], 0, 1);
    for (let i = 1; i < MAX_CANDLES + 10; i++) series = pushMark(series, i * CANDLE_MS, 1 + i);
    expect(series).toHaveLength(MAX_CANDLES);
  });
});

describe("seedCandles", () => {
  it("is deterministic and well formed", () => {
    const a = seedCandles(7, 100, 1_000_000, 0.02);
    expect(seedCandles(7, 100, 1_000_000, 0.02)).toEqual(a);
    expect(a.every((c) => c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close))).toBe(true);
    expect(a[a.length - 1]?.close).toBe(100);
    expect(a).toHaveLength(MAX_CANDLES);
  });
});
