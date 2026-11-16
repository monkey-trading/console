/** Tests for the engine's refusals in words. */

import { describe, expect, it } from "vitest";

import { describeEvent, describeMockAttestation, describeReject, describeReverifying, describeTierRate } from "./messages";

describe("order-limit and rate refusals", () => {
  it("names the tier and the most orders it rests", () => {
    expect(describeReject({ kind: "tier_order_limit", tier: 1, max: 50 })).toBe("You already have 50 open orders, the most for volume tier 1. Cancel one to place another, or trade more to reach a higher tier.");
    expect(describeReject({ kind: "too_many_orders", max: 100 })).toBe("You already have 100 open orders, the most allowed. Cancel one to place another.");
  });

  it("says why a weekend margin refuses a fill", () => {
    expect(describeReject({ kind: "weekend_margin", equity: "1000", required: "2500.5" })).toBe("Not enough margin while the higher weekend margin applies: your equity is $1,000.00 and you need $2,500.50.");
  });

  it("says a 429 for the tier's request rate recorded nothing", () => {
    expect(describeTierRate({ tier: 0, requestsPerSecond: 2 })).toBe("You're sending requests faster than volume tier 0 allows, which is 2 a second. Nothing was done. Wait a moment and try again.");
  });
});

describe("describeReject", () => {
  it("tells the live-key cap from the budget of new keys, which a revocation does not refill", () => {
    expect(describeReject({ kind: "too_many_session_keys", max: 10 })).toBe("This account already has the most session keys allowed.");
    expect(describeReject({ kind: "too_many_session_keys", max: 100 })).toBe("This account has added session keys too quickly. You can add one more each hour.");
  });

  it("names the numbers a slippage and a margin refusal carry", () => {
    expect(describeReject({ kind: "slippage", quoted: "100", live: "101", slippage_bps: 100 })).toContain("100 bps");
    expect(describeReject({ kind: "insufficient_margin", equity: "1000", required: "2500.5" })).toContain("$2,500.50");
    expect(describeReject({ kind: "insufficient_funds", available: "12" })).toContain("$12.00");
  });
});

describe("describeEvent", () => {
  it("reads the engine's financing sign: positive is charged, negative is credited", () => {
    const symbol = () => "BTC-USD";
    expect(describeEvent({ type: "financing", account: "0x1", market: 1, amount: "12.5" }, symbol)).toBe("Financing charged: $12.50 on BTC-USD");
    expect(describeEvent({ type: "financing", account: "0x1", market: 1, amount: "-3" }, symbol)).toBe("Financing credited: $3.00 on BTC-USD");
  });

  const symbol = () => "BTC-USD";
  it("describes activity and skips an acknowledgement", () => {
    expect(describeEvent({ type: "market_closed", market: 1 }, symbol)).toBe("BTC-USD closed");
    expect(describeEvent({ type: "order_accepted", account: "0x1", client_id: 1, order_id: 1 }, symbol)).toBeNull();
  });

  it("names an emission allocation and skips the period's housekeeping", () => {
    const amount = (2n ** 64n).toString();
    expect(describeEvent({ type: "emission_allocated", account: "0x1", period: 12, weight: "250.5", amount }, symbol)).toBe("MONKEY earned: 18.44 MONKEY (reward period 12)");
    expect(describeEvent({ type: "emission_period_closed", period: 12, budget: "1000", allocated: "999", cancelled: "1" }, symbol)).toBeNull();
  });

  it("leaves a vote's outcome to the Governance tab, out of the viewer's activity", () => {
    expect(describeEvent({ type: "proposal_scheduled", proposal: 7, applies_at: 1 }, symbol)).toBeNull();
    expect(describeEvent({ type: "restriction_applied", proposal: 8, expires_at: 1 }, symbol)).toBeNull();
    expect(describeEvent({ type: "proposal_refused", proposal: 9, reason: "rotation is off" }, symbol)).toBeNull();
    expect(describeEvent({ type: "restriction_lapsed", proposal: 8 }, symbol)).toBeNull();
  });
});

describe("describeMockAttestation", () => {
  it("names the simulation in the browser for the mock and an unverified test server for a live dev node, never the other's", () => {
    const mock = describeMockAttestation("none");
    const live = describeMockAttestation("checked");
    expect(mock).toEqual({ lead: "Demo mode.", rest: "This is a simulation running in your browser. Prices, trades and funds aren't real." });
    expect(live).toEqual({ lead: "Test server.", rest: "This server can't be verified, so it's for testing only. Prices, trades and funds aren't real." });
  });
});

describe("describeReverifying", () => {
  it("says trading is paused while the server is verified again, and that the prices shown are the last verified ones", () => {
    expect(describeReverifying()).toEqual({
      lead: "Checking the server again.",
      rest: "The server couldn't be verified, so trading is paused until it is. Prices shown are the last verified ones.",
    });
  });
});

describe("a fill's line", () => {
  const fill = { type: "fill" as const, account: "0x1", order_id: 1, market: 10, side: "buy" as const, qty: "1000000", price: "1.0800432", index: "1.08", spread_bps: 0, realised_pnl: "0", profit_fee: "0", position: "1000000", liquidation: false };

  it("states the spread paid in tenths of a bp, which the event's whole-bps field truncates to zero", () => {
    expect(describeEvent(fill, () => "EUR-USD")).toBe("buy 1,000,000 EUR-USD at 1.08004 (spread 0.4 bps)");
  });

  it("adds a close's hold and fee rate, and marks a close-out", () => {
    const close = { ...fill, side: "sell" as const, price: "1.0799568", hold_ms: 65_000, profit_fee_bps: 6_301, position: "0", liquidation: true };
    expect(describeEvent(close, () => "EUR-USD")).toBe("Close-out sell 1,000,000 EUR-USD at 1.07995 (spread 0.4 bps, held 1m 05s, fee 63.01% of profit)");
  });
});

describe("describeReject for a reversal over the close ceiling", () => {
  it("names the ceiling and the way through", () => {
    expect(describeReject({ kind: "close_spread_ceiling", ceiling_bps: 30 })).toBe("Reversing this position in one order would cost more than the 30 bps maximum spread. Close it first, then open the other side.");
  });
});

describe("describeReject for an invalid order", () => {
  it("words the engine's minimum and spread reasons, and shows any other reason as the node gives it", () => {
    expect(describeReject({ kind: "invalid_order", reason: "below minimum order notional" })).toBe("This order is below the market's minimum order size.");
    expect(describeReject({ kind: "invalid_order", reason: "below the minimum order of 100 USD at the trigger price" })).toBe("This order is below the market's minimum order size.");
    expect(describeReject({ kind: "invalid_order", reason: "spread at this size reaches the price" })).toBe("This order is too large to price. Try a smaller size.");
    expect(describeReject({ kind: "invalid_order", reason: "price out of range" })).toBe("This order can't be placed: price out of range.");
  });
});
