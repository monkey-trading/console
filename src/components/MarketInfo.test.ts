/** Tests for Market info's close-out sentence: the level the trading terms set, or no figure while they are not read. */

import { describe, expect, it } from "vitest";

import { describeCloseout, describeLevelDistance } from "./MarketInfo";

describe("describeCloseout", () => {
  it("states the close-out level the trading terms set, as a person says it", () => {
    expect(describeCloseout(5_000)).toBe("If your equity falls below 50% of your margin requirement, your positions are closed out.");
    expect(describeCloseout(6_250)).toBe("If your equity falls below 62.5% of your margin requirement, your positions are closed out.");
  });

  it("names no figure while the terms are not read", () => {
    expect(describeCloseout(null)).toBe("If your equity falls below the close-out level, which is a share of your margin requirement, your positions are closed out.");
  });
});

describe("describeLevelDistance", () => {
  it("states the market's minimum distance for take-profit and stop-loss levels as a person says it, and what it is measured from", () => {
    expect(describeLevelDistance(30)).toBe("A take profit or stop loss must be set at least 0.3% away from the price at which the position would close, on the correct side of it. For a limit or stop order, the distance is measured from the order's trigger price.");
    expect(describeLevelDistance(17)).toContain("at least 0.17% away");
  });
});
