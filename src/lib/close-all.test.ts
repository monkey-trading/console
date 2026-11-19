import { describe, expect, it } from "vitest";

import { describeLeftOut, planCloseAll, planGroupClose, pressBatch, pressCloseAll, targetsKey, type CloseRow, type HedgeMember } from "./close-all";

const row = (market: number, symbol: string, over: Partial<CloseRow> = {}): CloseRow => ({ market, symbol, open: true, quoted: 1_000_000_000n * BigInt(market), ...over });

describe("planning a close all", () => {
  it("sends every position with the price its own Close button quotes, in row order", () => {
    expect(planCloseAll([row(2, "ETH-USD"), row(1, "BTC-USD")]).targets).toEqual([{ market: 2, quoted: 2_000_000_000n }, { market: 1, quoted: 1_000_000_000n }]);
  });

  it("leaves out a position with no quote and names it", () => {
    const plan = planCloseAll([row(1, "BTC-USD"), row(2, "ETH-USD", { quoted: null }), row(3, "EUR-USD")]);
    expect(plan.targets.map((t) => t.market)).toEqual([1, 3]);
    expect(plan.leftOut).toEqual([{ symbol: "ETH-USD", why: "closing price not yet available" }]);
  });

  it("tells a position the node quotes only once its market is selected apart from one with no price yet", () => {
    const plan = planCloseAll([row(1, "BTC-USD", { quoted: null, select: true }), row(2, "ETH-USD", { quoted: null, select: false })]);
    expect(plan.leftOut).toEqual([{ symbol: "BTC-USD", why: "select it in the watchlist to load its closing price" }, { symbol: "ETH-USD", why: "closing price not yet available" }]);
    expect(describeLeftOut(plan.leftOut)).toBe("The following positions are not included in Close all: BTC-USD (select it in the watchlist to load its closing price), ETH-USD (closing price not yet available).");
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
    expect(describeLeftOut([{ symbol: "ETH-USD", why: "closing price not yet available" }, { symbol: "US500", why: "market closed" }])).toBe("The following positions are not included in Close all: ETH-USD (closing price not yet available), US500 (market closed).");
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

describe("pressing a batch whose confirmation is a preference", () => {
  it("asks for the second press as Close all does while the preference is on", () => {
    expect(pressBatch(true, "idle", 3)).toBe("arm");
    expect(pressBatch(true, "early", 3)).toBe("none");
    expect(pressBatch(true, "ready", 3)).toBe("send");
  });

  it("sends on the first press when it is off, and still sends nothing when there is nothing to send", () => {
    for (const state of ["idle", "early", "ready"] as const) {
      expect(pressBatch(false, state, 3)).toBe("send");
      expect(pressBatch(false, state, 0)).toBe("none");
    }
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

describe("planning a hedge's close", () => {
  const member = (market: number, over: Partial<HedgeMember> = {}): HedgeMember => ({ market, symbol: `M${market}`, open: true, quoted: 1_000_000_000n * BigInt(market), mark: 900_000_000n * BigInt(market), ...over });

  it("sends a hedge of more than four positions whole, at each quote where the node quotes it and at the mark where it does not", () => {
    // The node quotes at most four markets at once, so the fifth has no closing price of its own.
    const plan = planGroupClose([member(1), member(2), member(3), member(4), member(5, { quoted: null })]);
    expect(plan).toEqual({ targets: [1, 2, 3, 4].map((m) => ({ market: m, quoted: 1_000_000_000n * BigInt(m) })).concat({ market: 5, quoted: 4_500_000_000n }), untradable: [] });
  });

  it("leaves out and names a position whose market is closed or has no price, and closes the rest", () => {
    const plan = planGroupClose([member(1), member(2, { open: false }), member(3, { quoted: null, mark: null })]);
    expect(plan).toEqual({ targets: [{ market: 1, quoted: 1_000_000_000n }], untradable: ["M2", "M3"] });
  });

  it("sends nothing when no position of the hedge can trade", () => {
    expect(planGroupClose([member(1, { open: false }), member(2, { open: false })])).toEqual({ targets: [], untradable: ["M1", "M2"] });
  });
});
