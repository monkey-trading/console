/** Tests for spread bands in tenths of a bp: the staircase charge, and how bands, rates and notices read. */

import { describe, expect, it } from "vitest";

import type { SpreadTier } from "./engine/types";
import { fixedFromInt } from "./fixed";
import { bandRows, describeNotice, formatMultiplier, formatTenthBps, formatTenthPercent, marginRate, spreadRate, spreadStaircase, tenthBpsOf, tenthBpsOfValue } from "./spread-bands";

/** EUR-USD's bands in the engine's dev genesis. */
const EUR: SpreadTier[] = [{ up_to: "10000000", tenth_bps: 4 }, { up_to: "50000000", tenth_bps: 8 }, { up_to: null, tenth_bps: 16 }];

describe("tenthBpsOf", () => {
  it("reads a band in tenths as written and one in whole bps as ten tenths a bp", () => {
    expect([tenthBpsOf({ up_to: null, tenth_bps: 4 }), tenthBpsOf({ up_to: null, bps: 3 })]).toEqual([4, 30]);
  });
});

describe("spreadStaircase", () => {
  it("charges each band's tenths on the slice inside it, each band's charge rounded as asked", () => {
    // $12m through EUR-USD: 10m at 0.4bp and 2m at 0.8bp, 400 + 160.
    expect(spreadStaircase(EUR, 0n, fixedFromInt(12_000_000), "up")).toBe(fixedFromInt(560));
    // A slice inside the second band only.
    expect(spreadStaircase(EUR, fixedFromInt(11_000_000), fixedFromInt(12_000_000), "up")).toBe(fixedFromInt(80));
    // A raw unit at 0.4bp rounds up to a raw unit, and toward zero to none.
    expect([spreadStaircase(EUR, 0n, 1n, "up"), spreadStaircase(EUR, 0n, 1n, "toward-zero")]).toEqual([1n, 0n]);
    expect(spreadStaircase(EUR, fixedFromInt(5), fixedFromInt(5), "up")).toBe(0n);
  });
});

describe("rates in tenths", () => {
  it("read as bps with the tenth when there is one, and as a percentage to three places", () => {
    expect([formatTenthBps(4), formatTenthBps(10), formatTenthBps(20), formatTenthBps(125), formatTenthBps(0), formatTenthBps(-8)]).toEqual(["0.4 bps", "1 bp", "2 bps", "12.5 bps", "0 bps", "−0.8 bps"]);
    expect([formatTenthPercent(8), formatTenthPercent(1_234), formatTenthPercent(0)]).toEqual(["0.008%", "1.234%", "0.000%"]);
    expect([tenthBpsOfValue(fixedFromInt(8), fixedFromInt(100_000)), tenthBpsOfValue(1n, 0n)]).toEqual([8, 0]);
    expect([formatMultiplier(10_000), formatMultiplier(20_000), formatMultiplier(15_000), formatMultiplier(12_500)]).toEqual(["1", "2", "1.5", "1.25"]);
  });
});

describe("bandRows", () => {
  it("names each band's span of position notional with its rate", () => {
    expect(bandRows(EUR, spreadRate)).toEqual([{ span: "Up to $10.0M", rate: "0.4 bps" }, { span: "$10.0M to $50.0M", rate: "0.8 bps" }, { span: "Above $50.0M", rate: "1.6 bps" }]);
    expect(bandRows([{ up_to: null, bps: 100 }], marginRate)).toEqual([{ span: "Any size", rate: "1.00%" }]);
  });
});

describe("describeNotice", () => {
  it("states each value a listing notice names, and from when", () => {
    const effective_at = Date.UTC(2026, 10, 21, 14, 0, 0);
    expect(describeNotice({ spread_tiers: EUR, margin_tiers: [{ up_to: "5000000", bps: 50 }, { up_to: null, bps: 100 }], markup_bps: 90, effective_at })).toEqual([
      "From 21 Nov 14:00:00 UTC, the spread bands may become 0.4 bps up to $10.0M, 0.8 bps $10.0M to $50.0M, 1.6 bps above $50.0M.",
      "From 21 Nov 14:00:00 UTC, the margin bands may become 0.50% up to $5.00M, 1.00% above $5.00M.",
      "From 21 Nov 14:00:00 UTC, the financing markup may become 90 bps a year.",
    ]);
    expect(describeNotice({ effective_at })).toEqual([]);
  });
});
