/** Tests for the engine's refusals in words. */

import { describe, expect, it } from "vitest";

import { describeEvent, describeMockAttestation, describeReject, describeReverifying, describeTierRate } from "./messages";

describe("order-limit and rate refusals", () => {
  it("names the tier and the most orders it rests", () => {
    expect(describeReject({ kind: "tier_order_limit", tier: 1, max: 50 })).toBe("Working order limit reached. Volume tier 1 allows up to 50 working orders at a time. Cancel a working order to place a new one, or trade more to reach a higher tier.");
    expect(describeReject({ kind: "too_many_orders", max: 100 })).toBe("Working order limit reached. Your account can have up to 100 working orders at a time. Cancel a working order to place a new one.");
  });

  it("says why a weekend margin refuses a fill", () => {
    expect(describeReject({ kind: "weekend_margin", equity: "1000", required: "2500.5" })).toBe("Insufficient margin. The higher weekend margin applies in this market, so this order requires $2,500.50 of margin, and your equity is $1,000.00.");
  });

  it("says a 429 for the tier's request rate recorded nothing", () => {
    expect(describeTierRate({ tier: 0, requestsPerSecond: 2 })).toBe("Your request was not processed. You are sending requests faster than volume tier 0 allows, which is 2 per second. Wait a moment and try again.");
  });
});

describe("screening refusals", () => {
  const UNCHECKED = "Your eligibility could not be confirmed at the moment, so the request was not accepted. Please try again in a few moments.";

  it("says a request the source could not check is not a refusal of the trader's region", () => {
    for (const reason of ["source_unavailable", "source_invalid", "evidence_stale", "evidence_mismatch", "evidence_missing", "peer_unknown", "source_not_configured", "policy_missing", "protocol_inactive"] as const) {
      expect(describeReject({ kind: "access", reason })).toBe(UNCHECKED);
    }
  });

  it("keeps the region and eligibility wording for the source's own decisions", () => {
    expect(describeReject({ kind: "access", reason: "united_states" })).toBe("This service is not available in your region.");
    expect(describeReject({ kind: "access", reason: "sanctioned_jurisdiction" })).toBe("This service is not available in your region.");
    expect(describeReject({ kind: "access", reason: "eligibility_required" })).toBe("Your eligibility has not been declared. Sign the eligibility declaration to continue.");
    expect(describeReject({ kind: "access", reason: "already_attested" })).toBe("Your eligibility declaration has already been recorded.");
  });
});

describe("describeReject", () => {
  it("tells the live-key cap from the budget of new keys, which a revocation does not refill", () => {
    expect(describeReject({ kind: "too_many_session_keys", max: 10 })).toBe("This account already has the maximum number of session keys.");
    expect(describeReject({ kind: "too_many_session_keys", max: 100 })).toBe("This account has added too many session keys in a short time. One more can be added each hour.");
  });

  it("says what a stale request, an unpayable withdrawal and a far expiry mean for the trader, and what to do", () => {
    expect(describeReject({ kind: "invalid_nonce", expected: 4 })).toBe("Another request from your account was processed first, so this request was not accepted. Check your orders and positions, then try again.");
    expect(describeReject({ kind: "payout_unavailable" })).toBe("Withdrawals cannot be processed at the moment, and your balance has not been debited. Try again later.");
    expect(describeReject({ kind: "expiry_too_far", latest: 1 })).toBe("The request was rejected because its expiry time was too far ahead of the server's time. Check that your device clock is correct, then try again.");
  });

  it("names the numbers a slippage and a margin refusal carry", () => {
    expect(describeReject({ kind: "slippage", quoted: "100", live: "101", slippage_bps: 100 })).toBe(
      "Your order was not filled. The price moved 100 bps against you, from 100 to 101, which is more than your maximum slippage allows. Please try again at the current price.",
    );
    expect(describeReject({ kind: "insufficient_margin", equity: "1000", required: "2500.5" })).toBe("Insufficient margin. This order requires $2,500.50 of margin, and your equity is $1,000.00.");
    expect(describeReject({ kind: "insufficient_funds", available: "12" })).toBe("Insufficient funds. You can withdraw up to $12.00 at the moment.");
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
    expect(describeEvent({ type: "market_closed", market: 1 }, symbol)).toBe("BTC-USD market closed");
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
    expect(mock).toEqual({ lead: "Demo mode.", rest: "This is a simulation running in your browser. Prices, trades and funds are not real." });
    expect(live).toEqual({ lead: "Test server.", rest: "This server cannot be verified, so it is suitable for testing only. Prices, trades and funds are not real." });
  });
});

describe("describeReverifying", () => {
  it("says trading is paused while the server is verified again, and that the prices shown are the last verified ones", () => {
    expect(describeReverifying()).toEqual({
      lead: "Verifying the server again.",
      rest: "The trading server could not be verified, so trading has been suspended until verification succeeds. The prices shown are the last verified prices.",
    });
  });
});

describe("a fill's line", () => {
  const fill = { type: "fill" as const, account: "0x1", order_id: 1, market: 10, side: "buy" as const, qty: "1000000", price: "1.0800432", index: "1.08", spread_bps: 0, realised_pnl: "0", profit_fee: "0", position: "1000000", liquidation: false };

  it("states the spread paid in tenths of a bp, which the event's whole-bps field truncates to zero", () => {
    expect(describeEvent(fill, () => "EUR-USD")).toBe("Bought 1,000,000 EUR-USD at 1.08004 (spread 0.4 bps)");
  });

  it("adds a close's hold and fee rate, and marks a close-out", () => {
    const close = { ...fill, side: "sell" as const, price: "1.0799568", hold_ms: 65_000, profit_fee_bps: 6_301, position: "0", liquidation: true };
    expect(describeEvent(close, () => "EUR-USD")).toBe("Close-out: Sold 1,000,000 EUR-USD at 1.07995 (spread 0.4 bps, held 1m 05s, profit fee 63.01%)");
  });
});

describe("describeReject for a reversal over the close ceiling", () => {
  it("names the ceiling and the way through", () => {
    expect(describeReject({ kind: "close_spread_ceiling", ceiling_bps: 30 })).toBe("This order cannot reverse the position in a single trade, because its spread would exceed the market's maximum closing spread of 30 bps. Close the position first, then open a new position on the other side.");
  });
});

describe("describeReject for an invalid order", () => {
  it("words the engine's minimum, spread and range reasons, and shows any other reason as the node gives it", () => {
    expect(describeReject({ kind: "invalid_order", reason: "below minimum order notional" })).toBe("This order is below the market's minimum order value.");
    expect(describeReject({ kind: "invalid_order", reason: "below the minimum order of 100 USD at the trigger price" })).toBe("This order is below the market's minimum order value.");
    expect(describeReject({ kind: "invalid_order", reason: "spread at this size reaches the price" })).toBe("This order is too large to be priced. Please try a smaller order size.");
    expect(describeReject({ kind: "invalid_order", reason: "qty out of range" })).toBe("The order size is outside the range the server accepts.");
    expect(describeReject({ kind: "invalid_order", reason: "price out of range" })).toBe("The order price is outside the range the server accepts.");
    expect(describeReject({ kind: "invalid_order", reason: "market named twice" })).toBe("This order cannot be placed. Market named twice.");
  });
});
