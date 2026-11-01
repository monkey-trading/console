/** Tests for the order ticket's preview. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { NO_SIZE, previewTicket, slippageBound, TRIGGER_NOT_POSITIVE } from "./ticket";
import { account, btc, btcAt, heldIn, NAV, q } from "./ticket-fixtures";

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
    expect(previewTicket({ ...base, market, qty: 0n }).problems).toContain(NO_SIZE);
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

  it("shows no margin rate before there is a size or a position, and the tier's rate once there is", async () => {
    const market = await btcAt(100_000);
    const base = { market, side: "buy" as const, slippageBps: 10, account: account(10_000), houseNav: NAV };
    expect(previewTicket({ ...base, qty: 0n }).marginRateBps).toBeNull();
    expect(previewTicket({ ...base, market: { ...market, mark: null }, qty: q("0.5") }).marginRateBps).toBeNull();
    expect(previewTicket({ ...base, qty: q("0.5") }).marginRateBps).toBe(200);
    // An existing position gives an empty ticket its resulting position's rate.
    expect(previewTicket({ ...base, qty: 0n, account: heldIn(market, "0.5") }).marginRateBps).toBe(200);
    // Closing the whole position leaves none, and the order's own rate stands.
    expect(previewTicket({ ...base, side: "sell", qty: q("0.5"), account: heldIn(market, "0.5") }).marginRateBps).toBe(200);
  });

  it("refuses a resting order whose trigger price is not above zero, and never values it at one", async () => {
    const market = await btcAt(100_000);
    const base = { market, side: "buy" as const, slippageBps: 10, account: account(10_000), houseNav: NAV, resting: true, qty: q("0.5") };
    for (const trigger of [0n, q("-100")]) {
      const preview = previewTicket({ ...base, triggerPrice: trigger });
      expect(preview.problems, String(trigger)).toContain(TRIGGER_NOT_POSITIVE);
      expect(preview.notional).toBe(fixedFromInt(50_000)); // the mark values it, not the trigger
    }
    expect(previewTicket({ ...base, triggerPrice: q("0.000000001") }).problems).toContain("Minimum order is 100 USD.");
    expect(previewTicket({ ...base, triggerPrice: null }).problems).toEqual([]);
    // A market order ignores a trigger price left in the field.
    expect(previewTicket({ ...base, resting: false, triggerPrice: 0n }).problems).toEqual([]);
  });

  it("measures the house's cap as the larger of its NAV share and its floor, as the engine does", async () => {
    const market = await btcAt(100_000);
    const base = { side: "buy" as const, slippageBps: 10, account: account(10_000), qty: q("0.5") };
    const share = previewTicket({ ...base, market, houseNav: NAV });
    expect(share.houseCap).toBe(NAV / 20n); // 5% of the NAV, with no floor listed
    const floored = { ...market, view: { ...market.view, house_cap_floor: "300000" } };
    expect(previewTicket({ ...base, market: floored, houseNav: fixedFromInt(20_000) }).houseCap).toBe(fixedFromInt(300_000));
    expect(previewTicket({ ...base, market: floored, houseNav: NAV }).houseCap).toBe(NAV / 20n);
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
