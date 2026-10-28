/** Tests for the order ticket's preview. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { decodeMarket, type AccountModel } from "./models";
import { createMockNode } from "./mock";
import { previewTicket } from "./ticket";

const START = Date.UTC(2026, 9, 28, 15, 0, 0);

async function btc() {
  const node = createMockNode(START);
  const view = (await node.client.markets()).find((m) => m.symbol === "BTC-USD");
  if (!view) throw new Error("BTC-USD is listed");
  return decodeMarket(view, undefined);
}

const account = (equity: number, margin = 0): AccountModel => ({
  balance: fixedFromInt(equity), unfinalised: 0n, equity: fixedFromInt(equity), margin: fixedFromInt(margin), positions: [], orders: [],
});

describe("previewTicket", () => {
  it("quotes above the mark for a buy, sizes the margin from the tiers, and shows the margin use", async () => {
    const market = await btc();
    const preview = previewTicket({ market, side: "buy", notional: fixedFromInt(50_000), slippageBps: 10, account: account(10_000), houseNav: fixedFromInt(20_000_000) });
    expect(preview.quote?.price).toBeGreaterThan(market.mark ?? 0n);
    // The quantity rounds up to a millionth of a unit, so the margin is just over two percent of 50,000.
    expect(preview.marginAdded).toBeGreaterThanOrEqual(fixedFromInt(1_000));
    expect(preview.marginAdded).toBeLessThan(fixedFromInt(1_001));
    // Margin use is measured on the equity left after the spread this order pays.
    expect(preview.marginUseBps).toBeGreaterThan(1_000);
    expect(preview.marginUseBps).toBeLessThan(1_020);
    expect(preview.problems).toEqual([]);
    expect(preview.worstPrice).toBeGreaterThan(preview.quote?.price ?? 0n);
  });

  it("lists why an order cannot go: no equity, too much margin, closed; a resting order is admitted while closed", async () => {
    const market = await btc();
    const houseNav = fixedFromInt(20_000_000);
    expect(previewTicket({ market, side: "buy", notional: fixedFromInt(50_000), slippageBps: 10, account: null, houseNav }).problems).toContain("Fund your account to trade.");
    expect(previewTicket({ market, side: "buy", notional: fixedFromInt(900_000), slippageBps: 10, account: account(1_000), houseNav }).problems).toContain("Not enough equity for the margin this needs.");
    expect(previewTicket({ market: { ...market, open: false }, side: "buy", notional: fixedFromInt(1_000), slippageBps: 10, account: account(1_000), houseNav }).problems).toContain("This market is closed.");
    const closed = { market: { ...market, open: false }, side: "buy" as const, notional: fixedFromInt(1_000), slippageBps: 10, account: account(1), houseNav };
    expect(previewTicket({ ...closed, resting: true }).problems).toEqual([]);
  });

  it("shows the best bid and offer for the size, and the spread widens as the size grows", async () => {
    const market = await btc();
    const houseNav = fixedFromInt(20_000_000);
    const small = previewTicket({ market, side: "buy", notional: fixedFromInt(10_000), slippageBps: 10, account: account(1_000_000), houseNav });
    const large = previewTicket({ market, side: "buy", notional: fixedFromInt(900_000), slippageBps: 10, account: account(1_000_000), houseNav });
    expect(small.bid).toBeLessThan(market.mark ?? 0n);
    expect(small.offer).toBeGreaterThan(market.mark ?? 0n);
    expect(large.spreadBps).toBeGreaterThan(small.spreadBps);
    expect(small.quote?.price).toBe(small.offer);
  });

  it("charges the market's margin rate and reports the leverage it implies", async () => {
    const market = await btc();
    const preview = previewTicket({ market, side: "buy", notional: fixedFromInt(50_000), slippageBps: 10, account: account(10_000), houseNav: fixedFromInt(20_000_000) });
    expect(preview.marginRateBps).toBe(200);
    expect(preview.impliedLeverage).toBeGreaterThanOrEqual(49.9);
    expect(preview.impliedLeverage).toBeLessThanOrEqual(50.1);
  });
});
