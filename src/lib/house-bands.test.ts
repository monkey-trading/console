import { describe, expect, it } from "vitest";

import type { PositionsView, SideCounts } from "./engine/stats-types";
import { fixedFromWire } from "./fixed";
import { bandsWithin, bandUsd, closeoutBands, densityRows, houseResultAt, intensity, resultCurve } from "./house-bands";

const none: SideCounts = { long_usd: "0", long_count: 0, short_usd: "0", short_count: 0 };
const counts = (long: string, short: string): SideCounts => ({ long_usd: long, long_count: long === "0" ? 0 : 1, short_usd: short, short_count: short === "0" ? 0 : 1 });
const view = (extra: Partial<PositionsView>): PositionsView => ({
  market: 1, symbol: "BTC-USD", seq: 1, snapshot_ms: 1, mark: "100", closeout_range_bps: 2000, closeout_bucket_bps: 500, profit_range_bps: 1000, profit_bucket_bps: 500,
  long: { usd: "0", count: 0 }, short: { usd: "0", count: 0 }, due_now: none, closeout: [], beyond_range: none, profit: [], ...extra,
});

describe("closeoutBands", () => {
  it("keeps buckets that hold positions and have prices, lowest first", () => {
    const bands = closeoutBands(view({
      closeout: [
        { from_bps: 0, to_bps: 500, from_price: "100", to_price: "105", ...counts("0", "700") },
        { from_bps: -500, to_bps: 0, from_price: "95", to_price: "100", ...counts("300", "0") },
        { from_bps: 500, to_bps: 1000, from_price: "105", to_price: "110", ...none },
        { from_bps: 1000, to_bps: 1500, from_price: null, to_price: null, ...counts("9", "9") },
      ],
    }));
    expect(bands.map((b) => [b.fromPrice, b.toPrice, bandUsd(b)])).toEqual([[95, 100, 300], [100, 105, 700]]);
  });
});

describe("bandsWithin", () => {
  it("keeps the bands that touch the range around the mark and drops the rest", () => {
    const band = (fromPrice: number, toPrice: number) => ({ fromPrice, toPrice, longUsd: 1, shortUsd: 0, longCount: 1, shortCount: 0 });
    expect(bandsWithin([band(80, 90), band(94, 99), band(101, 106), band(110, 120)], 100, 500).map((b) => b.fromPrice)).toEqual([94, 101]);
  });
});

describe("intensity", () => {
  it("scales by the square root of the share of the heaviest band and clamps", () => {
    expect(intensity(25, 100)).toBe(0.5);
    expect(intensity(200, 100)).toBe(1);
    expect(intensity(5, 0)).toBe(0);
  });
});

describe("densityRows", () => {
  it("lists the profit buckets that hold positions with the most profit first", () => {
    const rows = densityRows(view({
      profit: [
        { from_bps: null, to_bps: -1000, ...counts("5", "0") },
        { from_bps: -1000, to_bps: -500, ...none },
        { from_bps: 500, to_bps: 1000, ...counts("0", "8") },
        { from_bps: 1000, to_bps: null, ...counts("2", "0") },
      ],
    }));
    expect(rows.map((r) => [r.label, r.long, r.short])).toEqual([["above +10.00%", 2, 0], ["+5.00% to +10.00%", 0, 8], ["below −10.00%", 5, 0]]);
  });
});

describe("houseResultAt", () => {
  it("is the opposite of clients' net notional times the move: the house loses when net long clients gain", () => {
    expect(houseResultAt(fixedFromWire("1000000"), 100)).toBe(fixedFromWire("-10000"));
    expect(houseResultAt(fixedFromWire("-1000000"), 100)).toBe(fixedFromWire("10000"));
    expect(houseResultAt(fixedFromWire("1000000"), 0)).toBe(0n);
  });

  it("draws a straight line through zero across the range", () => {
    const curve = resultCurve(fixedFromWire("1000000"), 100, 50);
    expect(curve.map((p) => p.bps)).toEqual([-100, -50, 0, 50, 100]);
    expect(curve.map((p) => p.usd)).toEqual([10000, 5000, 0, -5000, -10000]);
  });
});
