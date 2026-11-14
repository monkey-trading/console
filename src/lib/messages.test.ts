/** Tests for the engine's refusals in words. */

import { describe, expect, it } from "vitest";

import { describeEvent, describeMockAttestation, describeReject, describeReverifying } from "./messages";

describe("describeReject", () => {
  it("tells the live-key cap from the budget of new keys, which a revocation does not refill", () => {
    expect(describeReject({ kind: "too_many_session_keys", max: 10 })).toBe("This account already holds the most session keys the node allows.");
    expect(describeReject({ kind: "too_many_session_keys", max: 100 })).toBe("This account has added new session keys too quickly. The node allows one more each hour.");
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
    expect(describeEvent({ type: "emission_allocated", account: "0x1", period: 12, weight: "250.5", amount }, symbol)).toBe("MONKEY allocated: 18.44 MONKEY (period 12)");
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
  it("names the simulation in the browser for the mock and the dev-only verifier entry point for a live dev node, never the other's", () => {
    const mock = describeMockAttestation("none");
    const live = describeMockAttestation("checked");
    expect(mock.rest).toContain("Simulated node in your browser");
    expect(mock.rest).not.toContain("verifier");
    expect(live.rest).toContain("dev-only mock entry point");
    expect(live.rest).not.toContain("in your browser");
  });
});

describe("describeReverifying", () => {
  it("says what holds while the node is verified again: reads wait, signing is paused, and the stream's verified frames still arrive", () => {
    const { lead, rest } = describeReverifying();
    expect(lead).toBe("Re-verifying the node.");
    expect(rest).toContain("Reads wait and signing is paused");
    expect(rest).toContain("already verified");
    expect(rest).not.toContain("nothing is shown as trusted");
  });
});

describe("a fill's line", () => {
  const fill = { type: "fill" as const, account: "0x1", order_id: 1, market: 10, side: "buy" as const, qty: "1000000", price: "1.0800432", index: "1.08", spread_bps: 0, realised_pnl: "0", profit_fee: "0", position: "1000000", liquidation: false };

  it("states the spread paid in tenths of a bp, which the event's whole-bps field truncates to zero", () => {
    expect(describeEvent(fill, () => "EUR-USD")).toBe("buy 1,000,000 EUR-USD at 1.08004 (spread 0.4 bps)");
  });

  it("adds a close's hold and fee rate, and marks a close-out", () => {
    const close = { ...fill, side: "sell" as const, price: "1.0799568", hold_ms: 65_000, profit_fee_bps: 6_301, position: "0", liquidation: true };
    expect(describeEvent(close, () => "EUR-USD")).toBe("Close-out sell 1,000,000 EUR-USD at 1.07995 (spread 0.4 bps, held 1m 05s, fee 63.01% of a gain)");
  });
});

describe("describeReject for a reversal over the close ceiling", () => {
  it("names the ceiling and the way through", () => {
    expect(describeReject({ kind: "close_spread_ceiling", ceiling_bps: 30 })).toBe("Reversing this position here would pay a spread over its 30 bps close ceiling. Close it first, then open the other side.");
  });
});
