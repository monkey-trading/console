/** Tests for the mock's tiers, quotes and margin. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import type { Tier } from "./engine/types";
import { adverseBps, exceedsSlippage, growthOf, maxLeverage, quoteFor, slicedBps, tierCost, tieredMargin } from "./pricing";

const SPREAD: Tier[] = [
  { up_to: "250000", bps: 0 },
  { up_to: "1000000", bps: 3 },
  { up_to: null, bps: 8 },
];
const MARGIN: Tier[] = [
  { up_to: "100000", bps: 200 },
  { up_to: null, bps: 500 },
];

describe("slicedBps", () => {
  it("charges nothing inside the free band and weights a slice that crosses bands", () => {
    expect(slicedBps(SPREAD, 0n, fixedFromInt(100_000))).toBe(0);
    // 250k free + 250k at 3 bps over a 500k slice: 1.5 bps, truncated.
    expect(slicedBps(SPREAD, 0n, fixedFromInt(500_000))).toBe(1);
    expect(slicedBps(SPREAD, fixedFromInt(1_000_000), fixedFromInt(2_000_000))).toBe(8);
    expect(slicedBps(SPREAD, fixedFromInt(5), fixedFromInt(5))).toBe(0);
  });
});

describe("tieredMargin", () => {
  it("applies each band to the slice inside it", () => {
    expect(tieredMargin(MARGIN, fixedFromInt(100_000))).toBe(fixedFromInt(2_000));
    expect(tieredMargin(MARGIN, fixedFromInt(200_000))).toBe(fixedFromInt(7_000));
    expect(tieredMargin(MARGIN, fixedFromInt(-200_000))).toBe(fixedFromInt(7_000));
  });

  it("derives the leverage cap from the first band", () => {
    expect(maxLeverage(MARGIN)).toBe(50);
  });
});

describe("quoteFor", () => {
  const base = { index: fixedFromInt(100), baseSpreadBps: 10, spreadTiers: SPREAD, stress: 0, heldNotional: 0n, orderNotional: fixedFromInt(1_000), executedNotional: fixedFromInt(1_000) };

  it("moves a buy up and a sell down by the spread", () => {
    expect(quoteFor({ ...base, side: "buy" }).price).toBe(fixedFromInt(100) + fixedFromInt(100) / 1000n);
    expect(quoteFor({ ...base, side: "sell" }).price).toBe(fixedFromInt(100) - fixedFromInt(100) / 1000n);
  });

  it("adds the stress and size spreads, but no size spread to an order that does not grow the position", () => {
    expect(quoteFor({ ...base, side: "buy", stress: 2 }).spreadBps).toBe(22);
    expect(quoteFor({ ...base, side: "buy", orderNotional: 0n, executedNotional: fixedFromInt(1_000) }).spreadBps).toBe(10);
    expect(quoteFor({ ...base, side: "buy", orderNotional: fixedFromInt(2_000_000), executedNotional: fixedFromInt(2_000_000) }).spreadBps).toBe(10 + 5);
  });
});

describe("adverseBps", () => {
  it("counts only a worse live price", () => {
    expect(adverseBps("buy", fixedFromInt(100), fixedFromInt(101))).toBe(100);
    expect(adverseBps("buy", fixedFromInt(100), fixedFromInt(99))).toBe(0);
    expect(adverseBps("sell", fixedFromInt(100), fixedFromInt(99))).toBe(100);
  });
});

describe("exact tier charges", () => {
  it("keeps fractional basis points: a 110,000 position pays 2,500 of margin, not 2,497", () => {
    expect(tieredMargin(MARGIN, fixedFromInt(110_000))).toBe(fixedFromInt(2_000) + fixedFromInt(10_000) * 500n / 10_000n);
    expect(tierCost(MARGIN, 0n, fixedFromInt(110_000))).toBe(fixedFromInt(2_500));
  });
});

describe("growthOf", () => {
  it("counts the whole new side of a reversal as growth, and a pure reduction as none", () => {
    expect(growthOf(fixedFromInt(10), fixedFromInt(5))).toEqual({ grows: true, fromQty: fixedFromInt(10), toQty: fixedFromInt(15) });
    expect(growthOf(fixedFromInt(10), fixedFromInt(-4))).toMatchObject({ grows: false });
    expect(growthOf(fixedFromInt(10), fixedFromInt(-13))).toEqual({ grows: true, fromQty: 0n, toQty: fixedFromInt(3) });
    expect(growthOf(fixedFromInt(10), fixedFromInt(-10))).toMatchObject({ grows: false });
    expect(growthOf(0n, fixedFromInt(-2))).toEqual({ grows: true, fromQty: 0n, toQty: fixedFromInt(2) });
  });
});

describe("exceedsSlippage", () => {
  it("compares the exact difference, so 20.9 bps does not pass a 20 bps bound", () => {
    const quoted = fixedFromInt(10_000);
    expect(exceedsSlippage("buy", quoted, quoted + (quoted * 209n) / 10_000n / 10n, 20)).toBe(true);
    expect(exceedsSlippage("buy", quoted, quoted + (quoted * 20n) / 10_000n, 20)).toBe(false);
    expect(exceedsSlippage("sell", quoted, quoted + 1n, 0)).toBe(false);
  });
});

describe("a reversal's size charge", () => {
  it("is spread over the whole order, not only its growing slice", () => {
    const base = { index: fixedFromInt(100), side: "buy" as const, baseSpreadBps: 0, spreadTiers: SPREAD, stress: 0 };
    const reversal = quoteFor({ ...base, heldNotional: 0n, orderNotional: fixedFromInt(1_000_000), executedNotional: fixedFromInt(2_000_000) });
    const full = quoteFor({ ...base, heldNotional: 0n, orderNotional: fixedFromInt(1_000_000), executedNotional: fixedFromInt(1_000_000) });
    expect(reversal.spreadBps).toBeLessThan(full.spreadBps);
  });
});
