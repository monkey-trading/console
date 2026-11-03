/** The one plain-words paused state for the trading page (monkey-trading/console#273). */

import { describe, expect, it } from "vitest";

import { tradingPaused } from "./trading-paused";

const live = { handover: false, open: true, scheduleWords: null, priced: true, reduceOnly: false };

describe("tradingPaused", () => {
  it("is null for a live, open, priced market", () => {
    expect(tradingPaused(live)).toBeNull();
    expect(tradingPaused({ ...live, reduceOnly: false, scheduleWords: "Mon 08:00 UTC–Fri 20:00 UTC" })).toBeNull();
  });

  it("names a handover first, whatever else holds", () => {
    const state = tradingPaused({ ...live, handover: true, open: false, priced: false, reduceOnly: true });
    expect(state?.cause).toBe("handover");
    expect(state?.why).toContain("handing over");
    expect(state?.closesAllowed).toBe(true);
  });

  it("names a closed market with its schedule in words", () => {
    expect(tradingPaused({ ...live, open: false })?.why).toBe("the market is closed");
    expect(tradingPaused({ ...live, open: false, scheduleWords: "Mon 08:00–Fri 20:00 UTC" })?.why).toBe(
      "the market is closed (Mon 08:00–Fri 20:00 UTC)"
    );
  });

  it("names a missing price only while the market is open", () => {
    expect(tradingPaused({ ...live, priced: false })?.cause).toBe("price");
    expect(tradingPaused({ ...live, priced: false, open: false })?.cause).toBe("closed");
  });

  it("names reduce-only last and says closing still works", () => {
    const state = tradingPaused({ ...live, reduceOnly: true });
    expect(state?.cause).toBe("reduce_only");
    expect(state?.why).toContain("closing a position still works");
  });
});
