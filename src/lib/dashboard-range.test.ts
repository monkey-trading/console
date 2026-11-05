import { describe, expect, it } from "vitest";

import { DASHBOARD_RANGES, DEFAULT_DASHBOARD_RANGE, HOUSE_RANGE, MONKEY_TIMEFRAME } from "./dashboard-range";
import { MAX_POINTS, rangeOf, seriesQuery } from "./house-series";
import { timeframe } from "./monkey/timeframes";

const IDS = DASHBOARD_RANGES.map((range) => range.id);

describe("DASHBOARD_RANGES", () => {
  it("offers 1D, 7D, 30D, 1Y and All, opening on 7D", () => {
    expect(DASHBOARD_RANGES.map((range) => range.label)).toEqual(["1D", "7D", "30D", "1Y", "All"]);
    expect(DEFAULT_DASHBOARD_RANGE).toBe("7d");
  });
});

describe("the window each chart family reads", () => {
  it("maps every window to a defined House range and MONKEY timeframe", () => {
    for (const id of IDS) {
      expect(rangeOf(HOUSE_RANGE[id]).id).toBe(id);
      expect(timeframe(MONKEY_TIMEFRAME[id]).id).toBe(id);
    }
  });

  it("reads each window at the resolution that fits the node's 2,000-entry page", () => {
    // A day is 1,440 minute or 24 hourly buckets; a year is 365 daily ones: all within the page cap.
    expect(rangeOf(HOUSE_RANGE["1d"]).resolution).toBe("1m");
    expect(rangeOf(HOUSE_RANGE["7d"]).resolution).toBe("1h");
    expect(rangeOf(HOUSE_RANGE["30d"]).resolution).toBe("1h");
    expect(rangeOf(HOUSE_RANGE["1y"]).resolution).toBe("1d");
    expect(rangeOf(HOUSE_RANGE.all).resolution).toBe("1d");
    expect(timeframe(MONKEY_TIMEFRAME["1d"]).resolution).toBe("1h");
    expect(timeframe(MONKEY_TIMEFRAME["7d"]).resolution).toBe("1h");
    expect(timeframe(MONKEY_TIMEFRAME["30d"]).resolution).toBe("1d");
    expect(timeframe(MONKEY_TIMEFRAME["1y"]).resolution).toBe("1d");
    expect(timeframe(MONKEY_TIMEFRAME.all).resolution).toBe("1d");
  });

  it("asks every House chart read for at most the node's page of entries", () => {
    const now = 400 * 86_400_000;
    for (const id of IDS) expect(seriesQuery("nav", null, HOUSE_RANGE[id], now).limit).toBeLessThanOrEqual(MAX_POINTS);
    expect(seriesQuery("nav", null, HOUSE_RANGE.all, now)).toMatchObject({ resolution: "1d", fromMs: 0, limit: MAX_POINTS });
  });
});
