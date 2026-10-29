/** Tests for the engine's refusals in words. */

import { describe, expect, it } from "vitest";

import { describeEvent, describeMockAttestation, describeReject, describeReverifying } from "./messages";

describe("describeReject", () => {
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
