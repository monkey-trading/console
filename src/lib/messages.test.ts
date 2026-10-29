/** Tests for the engine's refusals in words. */

import { describe, expect, it } from "vitest";

import { describeEvent, describeReject } from "./messages";

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
