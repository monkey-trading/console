import { describe, expect, it } from "vitest";

import { closeAllOutcome, describeCancelAll, describeCloseAll, wholeRefusal } from "./batch-result";
import type { EngineEvent, Reject } from "./engine/types";

const ME = "0xabc0000000000000000000000000000000000001";
const SYMBOLS: Record<number, string> = { 1: "BTC-USD", 2: "ETH-USD", 3: "EUR-USD" };
const symbolOf = (market: number) => SYMBOLS[market] ?? String(market);
const rejected = (client_id: number, reason: Reject): EngineEvent => ({ type: "order_rejected", account: ME, client_id, reason });
const fill = (market: number): EngineEvent => ({ type: "fill", account: ME, order_id: market, market, side: "sell", qty: "1", price: "1", index: "1", spread_bps: 0, realised_pnl: "0", profit_fee: "0", position: "0", liquidation: false });
const accepted = (client_id: number): EngineEvent => ({ type: "order_accepted", account: ME, client_id, order_id: client_id + 10 });
const slippage: Reject = { kind: "slippage", quoted: "100", live: "90", slippage_bps: 1000 };

describe("telling a refusal of the whole request from the rejection of entry 0", () => {
  it("reads a lone client_id 0 rejection over several entries as the request's, whatever its reason", () => {
    for (const reason of [{ kind: "invalid_order", reason: "market named twice" }, slippage, { kind: "batch_unsupported" }] satisfies Reject[]) {
      expect(wholeRefusal([rejected(0, reason)], 3)).toEqual(reason);
    }
  });

  it("reads entry 0's rejection beside other entries' events as that entry's", () => {
    expect(wholeRefusal([rejected(0, slippage), accepted(1), fill(2)], 2)).toBeNull();
  });

  it("reads a lone client_id 0 rejection over one entry as the request's only for a request-level reason", () => {
    for (const reason of [{ kind: "batch_unsupported" }, { kind: "invalid_signature" }, { kind: "invalid_nonce", expected: 4 }, { kind: "access", reason: "united_states" }, { kind: "expired", expires_at: 1 }] satisfies Reject[]) {
      expect(wholeRefusal([rejected(0, reason)], 1)).toEqual(reason);
    }
    for (const reason of [slippage, { kind: "market_closed" }, { kind: "reduce_only" }, { kind: "invalid_order", reason: "qty out of range" }] satisfies Reject[]) {
      expect(wholeRefusal([rejected(0, reason)], 1)).toBeNull();
    }
  });

  it("does not read an entry's rejection at another index, or any other event, as the request's", () => {
    expect(wholeRefusal([rejected(1, slippage)], 2)).toBeNull();
    expect(wholeRefusal([fill(1)], 1)).toBeNull();
    expect(wholeRefusal([], 2)).toBeNull();
  });
});

describe("a close-all's per-entry outcomes", () => {
  it("names the market of a rejection by its list index, not its position in the events", () => {
    const events = [accepted(0), fill(2), rejected(1, slippage), accepted(2), fill(3)];
    expect(closeAllOutcome([2, 1, 3], events)).toEqual({
      kind: "entries",
      entries: [{ market: 2, result: "closed" }, { market: 1, result: "refused", reason: slippage }, { market: 3, result: "closed" }],
    });
  });

  it("matches a fill to its entry by market, so entries fill in any order", () => {
    expect(closeAllOutcome([3, 1], [fill(1), fill(3)])).toEqual({ kind: "entries", entries: [{ market: 3, result: "closed" }, { market: 1, result: "closed" }] });
  });

  it("marks an entry with neither a fill nor a rejection as unconfirmed", () => {
    expect(closeAllOutcome([1, 2], [fill(1)])).toEqual({ kind: "entries", entries: [{ market: 1, result: "closed" }, { market: 2, result: "unconfirmed" }] });
  });

  it("returns the whole-request refusal, not entries, for a lone refusal over several entries", () => {
    expect(closeAllOutcome([1, 2], [rejected(0, { kind: "batch_unsupported" })])).toEqual({ kind: "refused", reason: { kind: "batch_unsupported" } });
  });
});

describe("the close-all message", () => {
  const summary = (markets: number[], events: EngineEvent[]) => describeCloseAll(closeAllOutcome(markets, events), symbolOf);

  it("says all were closed", () => {
    expect(summary([1, 2], [fill(1), fill(2)])).toEqual({ tone: "ok", text: "Closed 2 positions." });
    expect(summary([1], [fill(1)])).toEqual({ tone: "ok", text: "Closed 1 position." });
  });

  it("says how many closed and names the market that moved past its bound", () => {
    expect(summary([1, 2, 3], [fill(1), rejected(1, slippage), fill(3)])).toEqual({ tone: "error", text: "Closed 2 of 3 positions; ETH-USD moved past its slippage bound." });
  });

  it("names every market that did not close, each with its reason", () => {
    expect(summary([1, 2, 3], [fill(1), rejected(1, { kind: "market_closed" }), rejected(2, { kind: "house_capacity" })]).text)
      .toBe("Closed 1 of 3 positions; ETH-USD's market is closed; EUR-USD: The house cannot take more in this market. Try a smaller size.");
  });

  it("says a position that was already flat had none left to close", () => {
    expect(summary([1, 2], [fill(1), rejected(1, { kind: "reduce_only" })]).text).toBe("Closed 1 of 2 positions; ETH-USD had no position left to close.");
  });

  it("says a market with no price has none right now", () => {
    expect(summary([1, 2], [fill(1), rejected(1, { kind: "no_price" })]).text).toBe("Closed 1 of 2 positions; ETH-USD has no price right now.");
  });

  it("says an entry it heard nothing for could not be confirmed closed", () => {
    expect(summary([1, 2], [fill(1)])).toEqual({ tone: "error", text: "Closed 1 of 2 positions; ETH-USD could not be confirmed closed." });
  });

  it("says none closed when none did", () => {
    expect(summary([1, 2], [rejected(0, slippage), rejected(1, slippage)])).toEqual({ tone: "error", text: "No position was closed: BTC-USD moved past its slippage bound; ETH-USD moved past its slippage bound." });
  });

  it("says nothing closed for a refusal of the whole request, with the node's reason", () => {
    const text = summary([1, 2], [rejected(0, { kind: "batch_unsupported" })]);
    expect(text.tone).toBe("error");
    expect(text.text).toMatch(/^Nothing was closed\. This node cannot cancel or close everything in one request yet/);
  });
});

describe("the cancel-all message", () => {
  const cancelled = (order_id: number): EngineEvent => ({ type: "order_cancelled", account: ME, order_id, reason: "client" });

  it("counts the orders the events cancelled", () => {
    expect(describeCancelAll([cancelled(1), cancelled(2), cancelled(3)])).toEqual({ tone: "ok", text: "Cancelled 3 orders." });
    expect(describeCancelAll([cancelled(1)])).toEqual({ tone: "ok", text: "Cancelled 1 order." });
  });

  it("says nothing was left when no event came back", () => {
    expect(describeCancelAll([])).toEqual({ tone: "info", text: "No resting orders were left to cancel." });
  });

  it("reports a refusal as such, never as a count", () => {
    const { tone, text } = describeCancelAll([rejected(0, { kind: "batch_unsupported" })]);
    expect(tone).toBe("error");
    expect(text).toMatch(/^Nothing was cancelled\./);
  });
});
