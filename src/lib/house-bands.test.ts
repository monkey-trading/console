import { describe, expect, it } from "vitest";

import type { PositionsView, SideCounts } from "./engine/stats-types";
import { fixedFromWire } from "./fixed";
import { bandsWithin, bandUsd, closeoutBands, DEFAULT_RANGE_BPS, densityRows, emptyMapNote, houseResultAt, intensity, neededRangeBps, offeredRanges, resultCurve, settledRangeBps } from "./house-bands";

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

/** A close-out bucket `from`..`to` bps from the mark of 100, holding `long` USD of longs. */
const bucket = (from: number, to: number, long = "5") => ({ from_bps: from, to_bps: to, from_price: String(100 + from / 100), to_price: String(100 + to / 100), ...counts(long, "0") });

describe("offeredRanges", () => {
  it("offers every step up to the node's whole range", () => {
    expect(offeredRanges(2000)).toEqual([100, 200, 500, 1000, 1500, 2000]);
    expect(offeredRanges(1000)).toEqual([100, 200, 500, 1000]);
  });

  it("adds the node's own range when no step is it, and offers it alone when it is narrower than every step", () => {
    expect(offeredRanges(750)).toEqual([100, 200, 500, 750]);
    expect(offeredRanges(50)).toEqual([50]);
  });
});

describe("neededRangeBps", () => {
  it("is the narrowest offered range that holds every band that has positions", () => {
    expect(neededRangeBps(view({ closeout: [bucket(-100, 0), bucket(0, 100)] }))).toBe(100);
    expect(neededRangeBps(view({ closeout: [bucket(-500, 0), bucket(0, 500, "0")] }))).toBe(500);
    expect(neededRangeBps(view({ closeout: [bucket(-700, -500)] }))).toBe(1000);
    expect(neededRangeBps(view({ closeout: [bucket(-2000, -1500), bucket(-700, -500)] }))).toBe(2000);
  });

  it("reaches the farthest band of a real node's answer: a levered close-out at -7% and a cross-margined one at -18.6%", () => {
    expect(neededRangeBps(view({ closeout: [bucket(-1900, -1800), bucket(-800, -700)] }))).toBe(2000);
    expect(neededRangeBps(view({ closeout: [bucket(-800, -700)] }))).toBe(1000);
  });

  it("ignores empty buckets and buckets without prices, which the map does not draw", () => {
    expect(neededRangeBps(view({ closeout: [bucket(-100, 0), bucket(-1900, -1800, "0"), { ...bucket(-1500, -1400), from_price: null, to_price: null }] }))).toBe(100);
  });

  it("keeps the default for a market with no band, and for one whose positions are all beyond the range", () => {
    expect(neededRangeBps(view({ closeout: [] }))).toBe(DEFAULT_RANGE_BPS);
    expect(neededRangeBps(view({ closeout: [bucket(-100, 0, "0")], beyond_range: counts("900", "0") }))).toBe(DEFAULT_RANGE_BPS);
  });

  it("stops at the node's own range", () => {
    expect(neededRangeBps(view({ closeout_range_bps: 1000, closeout: [bucket(-1000, -900)] }))).toBe(1000);
    expect(neededRangeBps(view({ closeout_range_bps: 300, closeout: [] }))).toBe(300);
  });
});

describe("settledRangeBps", () => {
  it("takes the needed range at a market's first answer", () => {
    expect(settledRangeBps(null, 1500)).toBe(1500);
  });

  it("only widens: a refresh that needs less leaves the range, one that needs more widens it", () => {
    expect(settledRangeBps(1500, 500)).toBe(1500);
    expect(settledRangeBps(500, 1500)).toBe(1500);
  });
});

describe("emptyMapNote", () => {
  it("is null while a band shows", () => {
    expect(emptyMapNote(view({ closeout: [bucket(-100, 0)] }), 500)).toBeNull();
  });

  it("says what lies beyond the node's range when nothing is in range", () => {
    const note = emptyMapNote(view({ beyond_range: counts("1500", "0") }), 500);
    expect(note).toBe("No positions close out within ±5% of the mark. $1.50K closes out beyond the node's ±20% range.");
  });

  it("points to a wider range when bands lie outside the chosen one", () => {
    expect(emptyMapNote(view({ closeout: [bucket(-1900, -1800)] }), 500)).toBe("No positions close out within ±5% of the mark. The nearest bands lie further out: choose a wider range.");
  });

  it("says only that nothing is in range when the node reports nothing beyond it either", () => {
    expect(emptyMapNote(view({}), 500)).toBe("No positions close out within ±5% of the mark.");
  });

  it("is null before the node has a mark", () => {
    expect(emptyMapNote(view({ mark: null }), 500)).toBeNull();
  });
});
