/** The one plain-words paused state for the trading page (monkey-trading/console#273). */

import { describe, expect, it } from "vitest";

import { tradingPaused } from "./trading-paused";

const live = { handover: false, unlisted: false, open: true, scheduleWords: null, priced: true, unfed: false, unpricedWhy: null, reduceOnly: false };

describe("tradingPaused", () => {
  it("is null for a live, open, priced market", () => {
    expect(tradingPaused(live)).toBeNull();
    expect(tradingPaused({ ...live, reduceOnly: false, scheduleWords: "Mon 08:00 UTC–Fri 20:00 UTC" })).toBeNull();
  });

  it("names a handover first, whatever else holds", () => {
    const state = tradingPaused({ ...live, handover: true, open: false, priced: false, reduceOnly: true });
    expect(state?.cause).toBe("handover");
    expect(state?.text).toBe("New orders are paused while the trading server changes. They will be accepted again automatically once the new server has been verified and live prices have returned.");
    expect(state?.closesAllowed).toBe(true);
  });

  it("names an operator on an unlisted node, after a handover and before the market's own states", () => {
    const state = tradingPaused({ ...live, unlisted: true, open: false, priced: false, reduceOnly: true });
    expect(state?.cause).toBe("unlisted");
    expect(state?.text).toBe("This version of the app does not recognise the next trading server, so trading has been suspended. Trading will resume once the app has been updated.");
    expect(state?.closesAllowed).toBe(true);
    expect(tradingPaused({ ...live, unlisted: true, handover: true })?.cause).toBe("handover");
  });

  it("names a closed market with its schedule in words", () => {
    expect(tradingPaused({ ...live, open: false })?.text).toBe("This market is currently closed.");
    expect(tradingPaused({ ...live, open: false, scheduleWords: "Mon 08:00–Fri 20:00 UTC" })?.text).toBe(
      "This market is currently closed. Its trading hours are Mon 08:00–Fri 20:00 UTC."
    );
  });

  it("names a missing price only while the market is open", () => {
    expect(tradingPaused({ ...live, priced: false })?.cause).toBe("price");
    expect(tradingPaused({ ...live, priced: false })?.text).toBe("No live price is currently available for this market, so trading has been suspended. Trading will resume automatically once a live price is available again.");
    expect(tradingPaused({ ...live, priced: false, open: false })?.cause).toBe("closed");
  });

  it("says a market no feed prices cannot be traded on this server, without promising it resumes, and keeps a closed market closed", () => {
    const state = tradingPaused({ ...live, priced: false, unfed: true, unpricedWhy: "the server is not currently receiving enough up-to-date prices" });
    expect(state).toEqual({ cause: "unfed", text: "Live prices for this market are not available on this server, so it cannot be traded.", closesAllowed: false });
    expect(tradingPaused({ ...live, priced: false, unfed: true, open: false })?.cause).toBe("closed");
  });

  it("names why a market has no price where the server says", () => {
    expect(tradingPaused({ ...live, priced: false, unpricedWhy: "the prices received from Kraken are delayed" })?.text).toBe(
      "No live price is currently available for this market because the prices received from Kraken are delayed, so trading has been suspended. Trading will resume automatically once a live price is available again.",
    );
    expect(tradingPaused({ ...live, priced: false, unpricedWhy: "the prices received from Kraken are delayed", open: false })?.cause).toBe("closed");
  });

  it("names reduce-only last and says closing still works", () => {
    const state = tradingPaused({ ...live, reduceOnly: true });
    expect(state?.cause).toBe("reduce_only");
    expect(state?.text).toBe("This market is currently accepting only orders that reduce an existing position. You can still close your position from the Positions tab.");
  });
});
