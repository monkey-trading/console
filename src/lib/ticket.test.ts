/** Tests for the order ticket's preview. */

import { describe, expect, it } from "vitest";

import { fixedFromInt, parseFixed } from "./fixed";
import type { MarketView } from "./engine/types";
import { decodeMarket, type AccountModel, type MarketModel } from "./models";
import { createMockNode } from "./mock";
import { contractUnit, NO_FX_PRICE, parseSize, previewTicket, slippageBound } from "./ticket";

const START = Date.UTC(2026, 9, 28, 15, 0, 0);

async function btc() {
  const node = createMockNode(START);
  const view = (await node.client.markets()).find((m) => m.symbol === "BTC-USD");
  if (!view) throw new Error("BTC-USD is listed");
  return decodeMarket(view, undefined, true);
}

const account = (equity: number, margin = 0): AccountModel => ({
  balance: fixedFromInt(equity), unfinalised: 0n, equity: fixedFromInt(equity), margin: fixedFromInt(margin), positions: [], orders: [],
});

const q = (text: string) => parseFixed(text) ?? 0n;
const NAV = fixedFromInt(20_000_000);

/** BTC-USD at a round mark, so a quantity's value is easy to read. */
async function btcAt(mark: number): Promise<MarketModel> {
  return { ...(await btc()), mark: fixedFromInt(mark) };
}

/** A market quoted in another currency, listed as the node serves it: `fx_mark` converts it, $100 minimum. */
async function quotedIn(currency: "eur" | "gbp" | "jpy", mark: number, fxMark: string | null, fxMarket = 3): Promise<MarketModel> {
  const base = await btcAt(mark);
  const view: MarketView = { ...base.view, id: 9, quote_currency: { currency, fx_market: fxMarket }, fx_mark: fxMark };
  return { ...base, id: 9, view };
}

const heldIn = (market: MarketModel, qty: string): AccountModel => ({ ...account(10_000), positions: [{ market: market.id, qty: q(qty), entry: market.mark ?? 0n }] });

describe("parseSize", () => {
  it("reads a size exactly as typed, to six decimal places", () => {
    expect(parseSize("0.5")).toEqual({ kind: "qty", qty: q("0.5") });
    expect(parseSize(" 12 ")).toEqual({ kind: "qty", qty: fixedFromInt(12) });
    expect(parseSize("0.123457")).toEqual({ kind: "qty", qty: 123_457_000n });
    expect(parseSize("0.000001")).toEqual({ kind: "qty", qty: 1_000n });
  });

  it("is empty for blank text, and passes trailing zeros past the step, which change no value", () => {
    expect(parseSize("")).toEqual({ kind: "empty" });
    expect(parseSize("   ")).toEqual({ kind: "empty" });
    expect(parseSize("0.5000000")).toEqual({ kind: "qty", qty: q("0.5") });
  });

  it("refuses more than six decimal places, saying so, rather than rounding", () => {
    expect(parseSize("0.0000001")).toEqual({ kind: "refused", message: "A size has at most 6 decimal places." });
    expect(parseSize("1.23456789")).toEqual({ kind: "refused", message: "A size has at most 6 decimal places." });
    expect(parseSize("0.12345678901234")).toEqual({ kind: "refused", message: "A size has at most 6 decimal places." });
  });

  it("refuses text that is not a plain decimal", () => {
    for (const text of ["abc", "-1", "+1", "1e3", "1,5", ".5", "1.", "0x10", "1 2"]) {
      expect(parseSize(text), text).toEqual({ kind: "refused", message: "Enter the size in digits, such as 0.5 or 2.25." });
    }
  });
});

describe("contractUnit", () => {
  it("names the base asset of a pair, and the instrument itself when it has no pair", async () => {
    const market = await btc();
    expect(contractUnit(market)).toBe("BTC");
    expect(contractUnit({ ...market, symbol: "US500" })).toBe("US500 unit");
  });
});

describe("previewTicket", () => {
  it("signs exactly the quantity entered, never rounded to a step", async () => {
    const market = await btcAt(100_000);
    for (const text of ["0.5", "0.123457", "0.000001", "2.000001", "1234.5"]) {
      const preview = previewTicket({ market, side: "buy", qty: q(text), slippageBps: 10, account: account(10_000_000), houseNav: NAV });
      expect(preview.qty, text).toBe(q(text));
    }
  });

  it("values the contracts in USD at the mark, and quotes above it for a buy with margin from the tiers", async () => {
    const market = await btcAt(100_000);
    const preview = previewTicket({ market, side: "buy", qty: q("0.5"), slippageBps: 10, account: account(10_000), houseNav: NAV });
    expect(preview.notional).toBe(fixedFromInt(50_000));
    expect(preview.markNotional).toBe(fixedFromInt(50_000));
    expect(preview.quote?.price).toBeGreaterThan(market.mark ?? 0n);
    // Two percent of 50,000, exactly: the quantity is not rounded up.
    expect(preview.marginAdded).toBe(fixedFromInt(1_000));
    // Margin use is measured on the equity left after the spread this order pays.
    expect(preview.marginUseBps).toBeGreaterThan(1_000);
    expect(preview.marginUseBps).toBeLessThan(1_020);
    expect(preview.problems).toEqual([]);
    expect(preview.worstPrice).toBeGreaterThan(preview.quote?.price ?? 0n);
  });

  it("lists why an order cannot go: no equity, too much margin, closed; a resting order is admitted while closed", async () => {
    const market = await btcAt(100_000);
    expect(previewTicket({ market, side: "buy", qty: q("0.5"), slippageBps: 10, account: null, houseNav: NAV }).problems).toContain("Fund your account to trade.");
    expect(previewTicket({ market, side: "buy", qty: q("9"), slippageBps: 10, account: account(1_000), houseNav: NAV }).problems).toContain("Not enough equity for the margin this needs.");
    expect(previewTicket({ market: { ...market, open: false }, side: "buy", qty: q("0.01"), slippageBps: 10, account: account(1_000), houseNav: NAV }).problems).toContain("This market is closed.");
    const closed = { market: { ...market, open: false }, side: "buy" as const, qty: q("0.01"), slippageBps: 10, account: account(1), houseNav: NAV };
    expect(previewTicket({ ...closed, resting: true }).problems).toEqual([]);
  });

  it("lists a refusal when the spread alone exhausts a positive equity", async () => {
    const market = await btcAt(100_000);
    const tiny = previewTicket({ market, side: "buy", qty: q("0.5"), slippageBps: 10, account: account(1), houseNav: NAV });
    expect(tiny.problems).toContain("Not enough equity for the margin this needs.");
  });

  it("checks the minimum on the exact quantity, with no rounding up to reach it", async () => {
    const market = await btcAt(100_000);
    const base = { market, side: "buy" as const, slippageBps: 10, account: account(10_000), houseNav: NAV };
    expect(previewTicket({ ...base, qty: q("0.001") }).problems).toEqual([]); // exactly $100
    expect(previewTicket({ ...base, qty: q("0.000999") }).problems).toContain("Minimum order is 100 USD.");
    expect(previewTicket({ ...base, qty: q("0.000999") }).qty).toBe(q("0.000999"));
  });

  it("checks a resting order's minimum at its trigger price, and shows it no worst price", async () => {
    const market = await btcAt(100_000);
    const base = { market, side: "buy" as const, slippageBps: 10, account: account(10_000), houseNav: NAV, resting: true };
    // 0.5 contracts is $50,000 at the mark but $2,500 at a $5,000 trigger: both clear; at $100 it is $50.
    expect(previewTicket({ ...base, qty: q("0.5"), triggerPrice: fixedFromInt(5_000) }).problems).toEqual([]);
    const low = previewTicket({ ...base, qty: q("0.5"), triggerPrice: fixedFromInt(100) });
    expect(low.problems).toContain("Minimum order is 100 USD.");
    expect(low.notional).toBe(fixedFromInt(50));
    expect(low.markNotional).toBe(fixedFromInt(50_000));
    expect(low.worstPrice).toBeNull();
    // With no trigger price typed yet, the mark values it.
    expect(previewTicket({ ...base, qty: q("0.5") }).notional).toBe(fixedFromInt(50_000));
    expect(previewTicket({ ...base, resting: false, qty: q("0.5") }).worstPrice).not.toBeNull();
  });

  it("says so with no price, no size, or a reduce-only market", async () => {
    const market = await btcAt(100_000);
    const base = { side: "buy" as const, slippageBps: 10, account: account(10_000), houseNav: NAV };
    const unpriced = previewTicket({ ...base, market: { ...market, mark: null }, qty: q("0.5") });
    expect(unpriced.problems).toEqual(["No price yet."]);
    expect(unpriced.notional).toBeNull();
    expect(unpriced.qty).toBe(q("0.5"));
    expect(previewTicket({ ...base, market, qty: 0n }).problems).toContain("Enter a size.");
    expect(previewTicket({ ...base, market: { ...market, reduceOnly: true }, qty: q("0.5") }).problems).toContain("This market only accepts orders that reduce a position.");
  });

  it("never applies the minimum to an order that only reduces a position, a short close included", async () => {
    const market = await btcAt(100_000);
    const base = { market, slippageBps: 10, houseNav: NAV };
    // A long of 0.0005 is worth $50, under the $100 minimum, and closing it whole must still go.
    const long = previewTicket({ ...base, side: "sell", qty: q("0.0005"), account: heldIn(market, "0.0005") });
    expect(long.problems).toEqual([]);
    expect(long.qty).toBe(q("0.0005"));
    // A short closes with a buy of its exact quantity, down to a size no ticket field could type.
    const short = previewTicket({ ...base, side: "buy", qty: 1_500n, account: heldIn(market, "-0.0000015") });
    expect(short.problems).toEqual([]);
    expect(short.qty).toBe(1_500n);
    expect(short.quote?.price).toBeGreaterThan(market.mark ?? 0n);
    // The same size opened from flat is under the minimum.
    expect(previewTicket({ ...base, side: "buy", qty: q("0.0005"), account: account(10_000) }).problems).toContain("Minimum order is 100 USD.");
    // Closing part of a short is a reduction too, and growing it is not.
    expect(previewTicket({ ...base, side: "buy", qty: q("0.0002"), account: heldIn(market, "-0.0005") }).problems).toEqual([]);
    expect(previewTicket({ ...base, side: "sell", qty: q("0.0002"), account: heldIn(market, "-0.0005") }).problems).toContain("Minimum order is 100 USD.");
  });

  it("checks the minimum on the whole quantity of an order that flips the position, as the engine does", async () => {
    const market = await btcAt(100_000);
    const base = { market, side: "sell" as const, slippageBps: 10, houseNav: NAV, account: heldIn(market, "0.5") };
    expect(previewTicket({ ...base, qty: q("0.5004") }).problems).toEqual([]);
    expect(previewTicket({ ...base, qty: q("0.5") }).problems).toEqual([]);
    const small = { ...base, account: heldIn(market, "0.0001") };
    // Selling 0.0005 against 0.0001 flips to a 0.0004 short: the order is worth $50, under the minimum.
    expect(previewTicket({ ...small, qty: q("0.0005") }).problems).toContain("Minimum order is 100 USD.");
  });

  it("values a market quoted in euros or pounds through its FX mark, rounded down", async () => {
    const base = { side: "buy" as const, slippageBps: 10, account: account(100_000), houseNav: NAV };
    const eur = await quotedIn("eur", 500, "1.1");
    // 0.2 x 500 = 100 EUR = 110 USD, and 0.19 x 500 = 95 EUR = 104.5 USD: both clear $100, where 95 untranslated would not.
    expect(previewTicket({ ...base, market: eur, qty: q("0.19") }).notional).toBe(q("104.5"));
    expect(previewTicket({ ...base, market: eur, qty: q("0.19") }).problems).toEqual([]);
    const short = previewTicket({ ...base, market: eur, qty: q("0.18") });
    expect(short.notional).toBe(q("99"));
    expect(short.problems).toContain("Minimum order is 100 USD.");
    // A euro worth 0.9 dollars makes the same 100 EUR only 90 USD.
    expect(previewTicket({ ...base, market: await quotedIn("eur", 500, "0.9"), qty: q("0.2") }).problems).toContain("Minimum order is 100 USD.");
    expect(previewTicket({ ...base, market: await quotedIn("gbp", 500, "1.25"), qty: q("0.16") }).notional).toBe(fixedFromInt(100));
    // The engine rounds the conversion down, so a hair under $100 is under.
    expect(previewTicket({ ...base, market: await quotedIn("gbp", 500, "1.25"), qty: q("0.159999") }).problems).toContain("Minimum order is 100 USD.");
  });

  it("values a yen-quoted market by dividing by its FX mark, and the pair's own listing at the price it is valued at", async () => {
    const base = { side: "buy" as const, slippageBps: 10, account: account(100_000), houseNav: NAV };
    // 1 contract at 30,000 yen, with the dollar at 150 yen, is $200.
    const nikkei = await quotedIn("jpy", 30_000, "150");
    expect(previewTicket({ ...base, market: nikkei, qty: q("1") }).notional).toBe(fixedFromInt(200));
    expect(previewTicket({ ...base, market: nikkei, qty: q("0.49") }).problems).toContain("Minimum order is 100 USD.");
    // The dollar against the yen lists itself as its FX market: a contract is a dollar whatever the rate.
    const pair = await quotedIn("jpy", 150, "150", 9);
    expect(previewTicket({ ...base, market: pair, qty: q("100") }).notional).toBe(fixedFromInt(100));
    expect(previewTicket({ ...base, market: pair, qty: q("99.999999") }).problems).toContain("Minimum order is 100 USD.");
    // A resting order on the pair converts at its trigger price, not at the mark.
    const resting = previewTicket({ ...base, market: pair, qty: q("100"), resting: true, triggerPrice: fixedFromInt(200) });
    expect(resting.notional).toBe(fixedFromInt(100));
    expect(resting.problems).toEqual([]);
  });

  it("says the order cannot be valued while an FX market has no mark, except for an order that only reduces", async () => {
    const base = { slippageBps: 10, houseNav: NAV };
    const eur = await quotedIn("eur", 500, null);
    const open = previewTicket({ ...base, market: eur, side: "buy", qty: q("1"), account: account(100_000) });
    expect(open.notional).toBeNull();
    expect(open.problems).toContain(NO_FX_PRICE);
    const close = previewTicket({ ...base, market: eur, side: "sell", qty: q("1"), account: heldIn(eur, "1") });
    expect(close.problems).toEqual([]);
    expect(close.quote).not.toBeNull();
    const missing = { ...eur, view: { ...eur.view } };
    delete missing.view.fx_mark;
    expect(previewTicket({ ...base, market: missing, side: "buy", qty: q("1"), account: account(100_000) }).problems).toContain(NO_FX_PRICE);
  });

  it("shows the best bid and offer for the size, and the spread widens as the size grows", async () => {
    const market = await btcAt(100_000);
    const small = previewTicket({ market, side: "buy", qty: q("0.1"), slippageBps: 10, account: account(1_000_000), houseNav: NAV });
    const large = previewTicket({ market, side: "buy", qty: q("9"), slippageBps: 10, account: account(1_000_000), houseNav: NAV });
    expect(small.bid).toBeLessThan(market.mark ?? 0n);
    expect(small.offer).toBeGreaterThan(market.mark ?? 0n);
    expect(large.spreadBps).toBeGreaterThan(small.spreadBps);
    expect(small.quote?.price).toBe(small.offer);
  });

  it("charges the market's margin rate and reports the leverage it implies", async () => {
    const market = await btcAt(100_000);
    const preview = previewTicket({ market, side: "buy", qty: q("0.5"), slippageBps: 10, account: account(10_000), houseNav: NAV });
    expect(preview.marginRateBps).toBe(200);
    expect(preview.impliedLeverage).toBeGreaterThanOrEqual(49.9);
    expect(preview.impliedLeverage).toBeLessThanOrEqual(50.1);
  });

  it("shows no margin use for a live node, whose quote it cannot know, and still sizes the margin", async () => {
    const market = await btcAt(100_000);
    const input = { market, side: "buy", qty: q("0.5"), slippageBps: 10, account: account(10_000), houseNav: NAV } as const;
    const live = previewTicket({ ...input, estimates: false });
    expect(live.marginUseBps).toBeNull();
    expect(live.marginAdded).toBe(previewTicket(input).marginAdded);
  });
});

describe("slippageBound", () => {
  it("keeps the user's choice up to the market's own bound, and the market's bound past it", async () => {
    const market = await btc();
    const capped = { ...market, view: { ...market.view, max_slippage_bps: 5 } };
    expect(slippageBound(10, market)).toBe(Math.min(10, market.view.max_slippage_bps));
    expect(slippageBound(10, capped)).toBe(5);
    expect(slippageBound(5, capped)).toBe(5);
    expect(slippageBound(4, capped)).toBe(4);
  });
});
