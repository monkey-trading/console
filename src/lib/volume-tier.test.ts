/** Tests for volume tiers: the table and the account's standing as the node serves them, the best-price bound, leverage and the step to the next tier. */

import { describe, expect, it } from "vitest";

import type { SpreadTier, Tier } from "./engine/types";
import type { VolumeStandingWire, VolumeTierWire } from "./engine/volume-types";
import { fixedFromInt } from "./fixed";
import { accountSpreadTiers, benefitsOf, bestPriceBound, decodeTiers, decodeVolume, flooredMargin, formatLeverage, maxLeverage, nextTier } from "./volume-tier";

/** The production genesis's table: shares of D1, floors of D5, limits of D11 and rates of D1. */
const TABLE: VolumeTierWire[] = [
  { threshold: "0", day_divisor: 1, best_price_share_bps: 2500, margin_floor_bps: 500, max_resting_orders: 25, requests_per_second: 2 },
  { threshold: "1000000", day_divisor: 2, best_price_share_bps: 5000, margin_floor_bps: 200, max_resting_orders: 50, requests_per_second: 5 },
  { threshold: "25000000", day_divisor: 5, best_price_share_bps: 10000, max_resting_orders: 100, requests_per_second: 10 },
  { threshold: "250000000", day_divisor: 10, best_price_share_bps: 25000, max_resting_orders: 250, requests_per_second: 20 },
];
/** BTC-USD's production bands: 1% to $2M, 2% to $10M, 5% above. */
const BTC_MARGIN: Tier[] = [{ up_to: "2000000", bps: 100 }, { up_to: "10000000", bps: 200 }, { up_to: null, bps: 500 }];
const BTC_SPREAD: SpreadTier[] = [{ up_to: "2000000", tenth_bps: 20 }, { up_to: "10000000", tenth_bps: 40 }, { up_to: null, tenth_bps: 80 }];

const standing = (extra: Partial<VolumeStandingWire> = {}): VolumeStandingWire => ({
  tier: 0, matured: "400000", pending: "1000", best_price_bounds: { "1": "500000" },
  progress: [{ capped: "400000", days: 1 }, { capped: "300000", days: 0 }, { capped: "40000", days: 0 }, { capped: "4000", days: 0 }],
  max_resting_orders: 25, requests_per_second: 2, ...extra,
});

describe("decodeTiers", () => {
  it("reads each tier's threshold, days, share, floor, order limit and rate, with none named as null", () => {
    const table = decodeTiers(TABLE);
    expect(table?.map((t) => [t.threshold, t.dayDivisor, t.bestPriceShareBps, t.marginFloorBps, t.maxRestingOrders, t.requestsPerSecond])).toEqual([
      [0n, 1, 2500, 500, 25, 2], [fixedFromInt(1_000_000), 2, 5000, 200, 50, 5], [fixedFromInt(25_000_000), 5, 10000, 0, 100, 10], [fixedFromInt(250_000_000), 10, 25000, 0, 250, 20],
    ]);
    const unnamed = decodeTiers([{ threshold: "0", day_divisor: 1, best_price_share_bps: 2500 }]);
    expect(unnamed?.[0]).toMatchObject({ marginFloorBps: 0, maxRestingOrders: null, requestsPerSecond: null });
  });

  it("reads no table from an empty list or a malformed tier, as a table is all or nothing", () => {
    expect(decodeTiers([])).toBeNull();
    expect(decodeTiers([...TABLE, { threshold: "x", day_divisor: 1, best_price_share_bps: 1 }])).toBeNull();
    expect(decodeTiers([{ threshold: "0", day_divisor: 0, best_price_share_bps: 1 }])).toBeNull();
  });
});

describe("decodeVolume", () => {
  it("reads the tier, counted and pending volume, progress, best-price bounds and limits", () => {
    const volume = decodeVolume(standing());
    expect(volume).toMatchObject({ tier: 0, matured: fixedFromInt(400_000), pending: fixedFromInt(1_000), maxRestingOrders: 25, requestsPerSecond: 2 });
    expect(volume?.progress).toHaveLength(4);
    expect(volume?.bestPriceBounds.get(1)).toBe(fixedFromInt(500_000));
  });

  it("reads limits a V59 node does not serve as null, and nothing from a malformed read", () => {
    const v59 = standing();
    delete v59.max_resting_orders;
    delete v59.requests_per_second;
    expect(decodeVolume(v59)).toMatchObject({ maxRestingOrders: null, requestsPerSecond: null });
    expect(decodeVolume(undefined)).toBeNull();
    expect(decodeVolume(standing({ matured: "lots" }))).toBeNull();
    expect(decodeVolume(standing({ progress: [{ capped: "1", days: -1 }] }))).toBeNull();
    expect(decodeVolume(standing({ best_price_bounds: { x: "1" } }))).toBeNull();
  });
});

describe("bestPriceBound", () => {
  it("ends the first band at the tier's share of the listed bound, at most the second bound", () => {
    expect(bestPriceBound(BTC_SPREAD, 2500)).toBe(fixedFromInt(500_000));
    expect(bestPriceBound(BTC_SPREAD, 5000)).toBe(fixedFromInt(1_000_000));
    expect(bestPriceBound(BTC_SPREAD, 10_000)).toBe(fixedFromInt(2_000_000));
    // Two and a half times the first bound is $5M, under the second band's $10M.
    expect(bestPriceBound(BTC_SPREAD, 25_000)).toBe(fixedFromInt(5_000_000));
    expect(bestPriceBound(BTC_SPREAD, 100_000)).toBe(fixedFromInt(10_000_000));
  });

  it("never takes the bound past the larger of the bound and the largest input, as the engine's bands do", () => {
    const wide: SpreadTier[] = [{ up_to: "500000000", tenth_bps: 20 }, { up_to: null, tenth_bps: 40 }];
    // 250% of $500M is $1.25B, capped at $1B.
    expect(bestPriceBound(wide, 25_000)).toBe(fixedFromInt(1_000_000_000));
    // A bound already above it is the ceiling.
    expect(bestPriceBound([{ up_to: "2000000000", tenth_bps: 20 }, { up_to: null, tenth_bps: 40 }], 25_000)).toBe(fixedFromInt(2_000_000_000));
  });

  it("has no bound for a market with one band", () => {
    expect(bestPriceBound([{ up_to: null, tenth_bps: 20 }], 2500)).toBeNull();
  });

  it("gives the account's bands with only the first band moved", () => {
    expect(accountSpreadTiers(BTC_SPREAD, 2500)).toEqual([{ up_to: "500000", tenth_bps: 20 }, BTC_SPREAD[1], BTC_SPREAD[2]]);
    expect(accountSpreadTiers([{ up_to: null, tenth_bps: 20 }], 2500)).toEqual([{ up_to: null, tenth_bps: 20 }]);
  });
});

describe("maxLeverage", () => {
  it("is the market's own leverage with no floor: 100x at 1% to the first band's end", () => {
    expect(formatLeverage(maxLeverage(BTC_MARGIN, 0))).toBe("100x");
  });

  it("is held to the floor: 20x at a 5% floor, 50x at 2%, and the market's own once the floor falls below its rate", () => {
    expect(formatLeverage(maxLeverage(BTC_MARGIN, 500))).toBe("20x");
    expect(formatLeverage(maxLeverage(BTC_MARGIN, 200))).toBe("50x");
    expect(formatLeverage(maxLeverage(BTC_MARGIN, 50))).toBe("100x");
  });

  it("peaks at a band's end where the average rate up to it is lowest", () => {
    // 2% to $100k then 10%: $100k needs $2k (50x); beyond it the average rate rises, and the last band alone is 10x.
    expect(formatLeverage(maxLeverage([{ up_to: "100000", bps: 200 }, { up_to: null, bps: 1000 }], 0))).toBe("50x");
    expect(maxLeverage([], 0)).toBe(0n);
  });
});

describe("flooredMargin", () => {
  it("charges each band at least the floor, and the market's own bands with none", () => {
    expect(flooredMargin(BTC_MARGIN, fixedFromInt(1_000_000), 0)).toBe(fixedFromInt(10_000));
    expect(flooredMargin(BTC_MARGIN, fixedFromInt(1_000_000), 500)).toBe(fixedFromInt(50_000));
    // Past $2M the second band's 2% is under the 5% floor too.
    expect(flooredMargin(BTC_MARGIN, fixedFromInt(3_000_000), 500)).toBe(fixedFromInt(150_000));
    expect(flooredMargin(BTC_MARGIN, -fixedFromInt(1_000_000), 500)).toBe(fixedFromInt(50_000));
  });
});

describe("nextTier", () => {
  const table = decodeTiers(TABLE) ?? [];

  it("names the volume left at the day cap and the fewest days that can cover it", () => {
    const volume = decodeVolume(standing());
    const next = volume === null ? null : nextTier(volume, table);
    // Tier 1 takes $1M over at least two days, $500k counting a day: $700k left is two more days at the cap.
    expect(next).toMatchObject({ tier: 1, volumeLeft: fixedFromInt(700_000), dayCap: fixedFromInt(500_000), daysNeeded: 2, daysLeast: 2 });
  });

  it("needs one more day when a day's cap covers what is left, and none once the volume is there", () => {
    const near = decodeVolume(standing({ progress: [{ capped: "0", days: 0 }, { capped: "900000", days: 1 }, { capped: "0", days: 0 }, { capped: "0", days: 0 }] }));
    expect(near === null ? null : nextTier(near, table)).toMatchObject({ volumeLeft: fixedFromInt(100_000), daysLeast: 1 });
    const there = decodeVolume(standing({ progress: [{ capped: "0", days: 0 }, { capped: "1000000", days: 1 }, { capped: "0", days: 0 }, { capped: "0", days: 0 }] }));
    expect(there === null ? null : nextTier(there, table)).toMatchObject({ volumeLeft: 0n, daysLeast: 0 });
  });

  it("counts the unit the engine truncates capped volume by, so a cap its divisor does not divide adds no day", () => {
    // $1M over 30 days: 29 capped days serve 29e15 / 30 = 966,666.666666666 after truncation, and one more day at the cap reaches the tier.
    const thirty = decodeTiers([...TABLE.slice(0, 1), { threshold: "1000000", day_divisor: 30, best_price_share_bps: 5000 }]) ?? [];
    const volume = decodeVolume({ ...standing(), progress: [{ capped: "0", days: 0 }, { capped: "966666.666666666", days: 29 }] });
    expect(volume === null ? null : nextTier(volume, thirty)).toMatchObject({ daysLeast: 1, daysNeeded: 30 });
  });

  it("has no next tier at the top of the table", () => {
    const top = decodeVolume(standing({ tier: 3 }));
    expect(top === null ? null : nextTier(top, table)).toBeNull();
  });
});

describe("benefitsOf", () => {
  it("states a tier's best-price size and leverage in a market, and the limits its terms name", () => {
    const [first, third] = [decodeTiers(TABLE)?.[0], decodeTiers(TABLE)?.[2]];
    const market = { spread_tiers: BTC_SPREAD, margin_tiers: BTC_MARGIN };
    expect(first && benefitsOf(first, market)).toEqual({ bestPriceBound: fixedFromInt(500_000), leverage: fixedFromInt(20), maxRestingOrders: 25, requestsPerSecond: 2 });
    expect(third && benefitsOf(third, market)).toEqual({ bestPriceBound: fixedFromInt(2_000_000), leverage: fixedFromInt(100), maxRestingOrders: 100, requestsPerSecond: 10 });
    expect(first && benefitsOf(first, undefined)).toMatchObject({ bestPriceBound: null, leverage: null });
  });
});
