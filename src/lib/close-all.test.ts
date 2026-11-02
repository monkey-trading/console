import { describe, expect, it } from "vitest";

import { describeLeftOut, planCloseAll, pressCloseAll, targetsKey, type CloseRow } from "./close-all";

const row = (market: number, symbol: string, over: Partial<CloseRow> = {}): CloseRow => ({ market, symbol, open: true, quoted: 1_000_000_000n * BigInt(market), ...over });

describe("planning a close all", () => {
  it("sends every position with the price its own Close button quotes, in row order", () => {
    expect(planCloseAll([row(2, "ETH-USD"), row(1, "BTC-USD")]).targets).toEqual([{ market: 2, quoted: 2_000_000_000n }, { market: 1, quoted: 1_000_000_000n }]);
  });

  it("leaves out a position with no quote and names it", () => {
    const plan = planCloseAll([row(1, "BTC-USD"), row(2, "ETH-USD", { quoted: null }), row(3, "EUR-USD")]);
    expect(plan.targets.map((t) => t.market)).toEqual([1, 3]);
    expect(plan.leftOut).toEqual([{ symbol: "ETH-USD", why: "no closing price yet" }]);
  });

  it("leaves out a position in a closed market, even with a quote, as its Close button is disabled", () => {
    const plan = planCloseAll([row(1, "BTC-USD", { open: false })]);
    expect(plan.targets).toEqual([]);
    expect(plan.leftOut).toEqual([{ symbol: "BTC-USD", why: "market closed" }]);
  });

  it("has nothing to send when every position lacks a quote", () => {
    const plan = planCloseAll([row(1, "BTC-USD", { quoted: null }), row(2, "ETH-USD", { quoted: null })]);
    expect(plan.targets).toEqual([]);
    expect(plan.leftOut).toHaveLength(2);
  });

  it("keeps a zero quote, which is a price, apart from no quote", () => {
    expect(planCloseAll([row(1, "BTC-USD", { quoted: 0n })]).targets).toEqual([{ market: 1, quoted: 0n }]);
  });
});

describe("describing what a close all leaves out", () => {
  it("names each position and why", () => {
    expect(describeLeftOut([{ symbol: "ETH-USD", why: "no closing price yet" }, { symbol: "US500", why: "market closed" }])).toBe("Close all leaves out ETH-USD (no closing price yet), US500 (market closed).");
  });

  it("says nothing when nothing is left out", () => {
    expect(describeLeftOut([])).toBeNull();
  });
});

describe("pressing Close all", () => {
  it("arms on the first press and sends only on a later press inside the window", () => {
    expect(pressCloseAll("idle", 3)).toBe("arm");
    expect(pressCloseAll("ready", 3)).toBe("send");
  });

  it("ignores a press that follows the first by a moment, so a double-click does not confirm", () => {
    expect(pressCloseAll("early", 3)).toBe("none");
  });

  it("does nothing when no position qualifies, whatever the window says", () => {
    for (const state of ["idle", "early", "ready"] as const) expect(pressCloseAll(state, 0)).toBe("none");
  });
});

describe("the list a confirm window is armed for", () => {
  it("changes when a market joins, leaves or swaps, though the count may not", () => {
    const at = (...markets: number[]) => targetsKey(markets.map((market) => ({ market, quoted: 1n })));
    expect(at(1, 2)).toBe(at(1, 2));
    expect(at(1, 2)).not.toBe(at(1, 2, 3));
    expect(at(1, 2)).not.toBe(at(1, 3));
    expect(at()).toBe("");
  });
});
