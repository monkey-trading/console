/** Tests for the engine's refusals in words. */

import { describe, expect, it } from "vitest";

import { describeEvent, describeReject } from "./messages";

describe("describeReject", () => {
  it("names the numbers a slippage and a margin refusal carry", () => {
    expect(describeReject({ type: "slippage", quoted: "100", live: "101", slippage_bps: 100 })).toContain("100 bps");
    expect(describeReject({ type: "insufficient_margin", equity: "1000", required: "2500.5" })).toContain("$2,500.50");
    expect(describeReject({ type: "insufficient_funds", available: "12" })).toContain("$12.00");
  });
});

describe("describeEvent", () => {
  const symbol = () => "BTC-USD";
  it("describes activity and skips an acknowledgement", () => {
    expect(describeEvent({ type: "market_closed", market: 1 }, symbol)).toBe("BTC-USD closed");
    expect(describeEvent({ type: "order_accepted", account: "0x1", client_id: 1, order_id: 1 }, symbol)).toBeNull();
  });
});
