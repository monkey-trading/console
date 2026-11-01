/** Tests for reading the node's executable quotes into the ticket's prices. */

import { describe, expect, it } from "vitest";

import type { MarketQuote } from "./engine/types";
import { fixedFromWire } from "./fixed";
import { closingPrice, executablePrice, MAX_QUOTED_MARKETS, quoteMarkets, ticketPrices, UNCREDITED } from "./quotes";
import type { TicketPreview } from "./ticket";

const QUOTE: MarketQuote = {
  type: "quote", account: "0xabc", market: 1, open: true, reduce_only: false, stress_level: 0, mark: "100",
  ask: [{ qty: "1", price: "100.1" }, { qty: "5", price: "100.3" }, { qty: "8", price: "100.5", declined: { kind: "insufficient_margin", equity: "10", required: "40" } }],
  bid: [{ qty: "1", price: "99.9" }, { qty: "5", price: "99.7" }],
  close: { side: "sell", qty: "2", price: "99.8" },
};
const f = fixedFromWire;
// Only the fields `ticketPrices` reads; the rest of a preview does not reach it.
const preview = (qty: string) => ({ qty: f(qty), bid: f("99"), offer: f("101"), quote: { price: f("101") }, spreadBps: 200 }) as unknown as TicketPreview;
const live = (qty: string, side: "buy" | "sell", quote: MarketQuote | null = QUOTE, quoteError: string | null = null, mark = "100") =>
  ticketPrices({ live: true, quote, quoteError, preview: preview(qty), side, mark: f(mark) });

describe("quoteMarkets", () => {
  it("asks for the selected market first, then the markets held, once each and at most four", () => {
    expect(quoteMarkets(2, [1, 2, 3])).toEqual([2, 1, 3]);
    expect(quoteMarkets(9, [1, 2, 3, 4, 5])).toEqual([9, 1, 2, 3]);
    expect(quoteMarkets(9, [1, 2, 3, 4, 5])).toHaveLength(MAX_QUOTED_MARKETS);
  });
});

describe("executablePrice", () => {
  it("takes the first step whose size covers the order, counting a step's own size as covered", () => {
    expect(executablePrice(QUOTE, "buy", f("0.5"))).toEqual({ price: f("100.1"), declined: null });
    expect(executablePrice(QUOTE, "buy", f("1"))).toEqual({ price: f("100.1"), declined: null });
    expect(executablePrice(QUOTE, "buy", f("1.000000001"))).toEqual({ price: f("100.3"), declined: null });
    expect(executablePrice(QUOTE, "sell", f("5"))).toEqual({ price: f("99.7"), declined: null });
  });

  it("carries the node's reason a size would be declined, and has no price past the last step", () => {
    expect(executablePrice(QUOTE, "buy", f("6"))).toEqual({ price: f("100.5"), declined: { kind: "insufficient_margin", equity: "10", required: "40" } });
    expect(executablePrice(QUOTE, "buy", f("8.000001"))).toBeNull();
    expect(executablePrice({ ...QUOTE, bid: [] }, "sell", f("0.1"))).toBeNull();
  });
});

describe("closingPrice", () => {
  it("prices a close only of exactly the whole position on its side", () => {
    expect(closingPrice(QUOTE, "sell", f("2"))).toBe(f("99.8"));
    expect(closingPrice(QUOTE, "sell", f("1"))).toBeNull();
    expect(closingPrice(QUOTE, "buy", f("2"))).toBeNull();
    expect(closingPrice({ ...QUOTE, close: null }, "sell", f("2"))).toBeNull();
  });
});

describe("ticketPrices", () => {
  it("shows a live node's bid and offer for the size, sends the price on the order's side, and spreads them over the mark", () => {
    expect(live("3", "buy")).toEqual({ bid: f("99.7"), offer: f("100.3"), price: f("100.3"), spreadBps: 60, problem: null });
    expect(live("3", "sell")).toMatchObject({ price: f("99.7"), problem: null });
  });

  it("says why a live order has no price: no quote yet, an account not yet credited, no market price, too large, or declined", () => {
    expect(live("1", "buy", null)).toEqual({ bid: null, offer: null, price: null, spreadBps: null, problem: "Waiting for the node's executable quote." });
    expect(live("1", "buy", null, UNCREDITED).problem).toBe("The node quotes an account once it has credited it: deposit and declare your eligibility first.");
    expect(live("1", "buy", null, "unknown market 9").problem).toBe("The node will not quote this market: unknown market 9.");
    expect(live("1", "buy", { ...QUOTE, unavailable: { kind: "market_closed" }, ask: [], bid: [] })).toMatchObject({ price: null, problem: "The market is closed." });
    expect(live("6", "sell")).toMatchObject({ price: null, offer: f("100.5"), problem: "The node would not open an order this large. Try a smaller size." });
    expect(live("6", "buy")).toMatchObject({ price: f("100.5"), problem: "The largest size your equity opens here is ≈ 5 contracts. Try a smaller size." });
  });

  it("shows the mock's own estimate, which needs no quote", () => {
    expect(ticketPrices({ live: false, quote: null, quoteError: null, preview: preview("1"), side: "buy", mark: f("100") })).toEqual({ bid: f("99"), offer: f("101"), price: f("101"), spreadBps: 200, problem: null });
  });
});

describe("a covering step the node's ladder declines", () => {
  // console#66: a $10,000 ticket on a $1,000 account rounded up to 0.128865 BTC, a hair past the
  // largest openable 0.128860, and landed on the declined probe at the $2M tier top, whose margin
  // figures ($299,999.99 for the probe, a negative probe equity) were shown as the order's.
  const BTC_MARK = "77600";
  const btcLadder: MarketQuote = {
    ...QUOTE,
    mark: BTC_MARK,
    ask: [
      { qty: "0.05", price: "77610" },
      { qty: "0.12886", price: "77640" },
      { qty: "25.75", price: "77900", declined: { kind: "insufficient_margin", equity: "1000", required: "299999.99" } },
    ],
  };

  it("shows the largest size the account can open, never the probe's equity or margin", () => {
    const result = live("0.128865", "buy", btcLadder, null, BTC_MARK);
    expect(result.problem).toBe("The largest size your equity opens here is ≈ 0.12886 contracts. Try a smaller size.");
    expect(result.price).toBe(f("77900"));
  });

  it("names the largest size at the size field's six places, and in the singular for one contract", () => {
    const margin = { kind: "insufficient_margin" as const, equity: "1", required: "9" };
    const ladder = (fitting: string): MarketQuote => ({ ...QUOTE, ask: [{ qty: fitting, price: "100.1" }, { qty: "30", price: "100.5", declined: margin }] });
    expect(live("29", "buy", ladder("25.773195876")).problem).toBe("The largest size your equity opens here is ≈ 25.773195 contracts. Try a smaller size.");
    expect(live("29", "buy", ladder("1")).problem).toBe("The largest size your equity opens here is ≈ 1 contract. Try a smaller size.");
    expect(live("29", "buy", ladder("0.0000005")).problem).toBe("Not enough equity to open a position here.");
  });

  it("keeps a decline whose message carries no probe figures, and refuses no-size accounts without figures", () => {
    const capped: MarketQuote = {
      ...QUOTE,
      ask: [
        { qty: "1", price: "100.1" },
        { qty: "5", price: "100.3" },
        { qty: "8", price: "100.5", declined: { kind: "house_capacity" } },
      ],
    };
    expect(live("6", "buy", capped).problem).toBe("The house cannot take more in this market. Try a smaller size.");
    const nothingFits: MarketQuote = { ...QUOTE, ask: [{ qty: "1", price: "100.1", declined: { kind: "insufficient_margin", equity: "0", required: "40" } }] };
    expect(live("0.5", "buy", nothingFits).problem).toBe("Not enough equity to open a position here.");
  });
});
