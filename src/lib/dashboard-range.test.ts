import { describe, expect, it } from "vitest";

import { DASHBOARD_RANGES, DEFAULT_DASHBOARD_RANGE } from "./dashboard-range";
import { ALL_WINDOW_MS, MAX_POINTS, rangeOf, seriesQuery } from "./house-series";
import { timeframe } from "./monkey/timeframes";

describe("DASHBOARD_RANGES", () => {
  it("offers 1D, 7D, 30D, 1Y and All, opening on 7D", () => {
    expect(DASHBOARD_RANGES.map((range) => range.label)).toEqual(["1D", "7D", "30D", "1Y", "All"]);
    expect(DEFAULT_DASHBOARD_RANGE).toBe("7d");
  });
});

describe("the window each chart family reads", () => {
  it("names every window as both families' own id, so the choice passes straight through", () => {
    for (const { id } of DASHBOARD_RANGES) {
      expect(rangeOf(id).id).toBe(id);
      expect(timeframe(id).id).toBe(id);
    }
  });

  it("reads each window at the resolution that fits the node's 2,000-entry page", () => {
    // A day is 1,440 minute or 24 hourly buckets; a year is 365 daily ones: all within the page cap.
    expect(rangeOf("1d").resolution).toBe("1m");
    expect(rangeOf("7d").resolution).toBe("1h");
    expect(rangeOf("30d").resolution).toBe("1h");
    expect(rangeOf("1y").resolution).toBe("1d");
    expect(rangeOf("all").resolution).toBe("1d");
    expect(timeframe("1d").resolution).toBe("1h");
    expect(timeframe("7d").resolution).toBe("1h");
    expect(timeframe("30d").resolution).toBe("1d");
    expect(timeframe("1y").resolution).toBe("1d");
    expect(timeframe("all").resolution).toBe("1d");
  });

  it("keeps every House chart read inside the node's page, and All inside the most recent days that fit it", () => {
    const now = 4_000 * 86_400_000;
    for (const { id } of DASHBOARD_RANGES) expect(seriesQuery("nav", null, id, now).limit).toBeLessThanOrEqual(MAX_POINTS);
    const all = seriesQuery("nav", null, "all", now);
    expect(all).toMatchObject({ resolution: "1d", limit: MAX_POINTS });
    expect(all.fromMs).toBe(now - ALL_WINDOW_MS);
    expect(all.fromMs).toBeGreaterThan(0);
  });
});
