/** Tests for the deal ticket's levels from the console's state: the closing price they are measured from, and the account's slots. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { createMockNode } from "./mock";
import { closingPrice } from "./mock/levels";
import { decodeMarket } from "./models";
import { CALM } from "./pricing";
import { formatMark } from "./price-format";
import { initialState } from "./store/state";
import { closingAt, closingExact, editorReference, ticketLevels } from "./ticket-levels";
import { heldIn, q } from "./ticket-fixtures";
import { accountSpreadTiers } from "./volume-tier";

const START = Date.UTC(2026, 9, 28, 15, 0, 0);
const ME = "0xabc0000000000000000000000000000000000001";

async function fixture() {
  const node = createMockNode(START);
  const views = await node.client.markets();
  const market = views.map((v) => decodeMarket(v, undefined, true)).find((m) => m.id === 1);
  if (market === undefined) throw new Error("BTC-USD is listed");
  return { node, market, state: initialState(views, { cash: "0", nav: "0", gross_exposure: "0" }, START, () => [], "none") };
}

describe("closingAt", () => {
  it("prices a whole close as the mock's engine does, for a long and a short, past the first band", async () => {
    const { node, market } = await fixture();
    // The mock's account is at tier 0, whose first band ends at a quarter of the listing's.
    const tiers = accountSpreadTiers(market.view.spread_tiers, 2_500);
    for (const held of [q("0.1"), -q("0.1"), fixedFromInt(40), -fixedFromInt(40)]) {
      expect(closingAt(market, held, { tiers, stress: CALM, toxicityBps: 0 })).toBe(closingPrice(node.client.state, ME, 1, held));
    }
  });

  it("has no price with no position or no mark", async () => {
    const { market } = await fixture();
    const terms = { tiers: market.view.spread_tiers, stress: CALM, toxicityBps: 0 };
    expect(closingAt(market, 0n, terms)).toBeNull();
    expect(closingAt({ ...market, mark: null }, q("1"), terms)).toBeNull();
  });
});

describe("ticketLevels", () => {
  const prices = (price: bigint | null) => ({ bid: null, offer: null, price, exactClose: false, toxicityBps: 0, spreadTenths: null, problem: null, problemIsSize: false });

  it("measures a market order's levels from the closing price of the position it leaves, not the one held", async () => {
    const { node, state, market } = await fixture();
    // 20 BTC held and 20 more bought: with no volume tier in the account read the listing's first band applies, to $2,000,000, which
    // at about $67,000 a coin the larger long crosses and the held one does not, so the larger one closes at a lower price.
    const account = heldIn(market, "20");
    const order = { side: "buy" as const, qty: fixedFromInt(20), slippageBps: 25, resting: false, triggerPrice: null };
    const current = { ...state, account, houseParams: node.client.state.params, pricingCurrent: true };
    const check = ticketLevels(current, market, order, { takeProfit: "1", stopLoss: "" }, { prices: prices(market.mark), limits: null });
    const terms = { tiers: market.view.spread_tiers, stress: CALM, toxicityBps: 0 };
    const left = closingAt(market, fixedFromInt(40), terms);
    const held = closingAt(market, fixedFromInt(20), terms);
    if (left === null || held === null) throw new Error("both longs have a closing price");
    expect(formatMark(left, 2)).not.toBe(formatMark(held, 2));
    expect(check?.problems.take_profit).toContain(`which is currently ${formatMark(left, 2)},`);
  });

  it("measures a live market order's take profit from the mark at any size, and its stop loss from the closing price", async () => {
    const { node, state, market } = await fixture();
    const live = { ...market, ceilingBps: null };
    const order = { side: "buy" as const, qty: q("0.01"), slippageBps: 25, resting: false, triggerPrice: null };
    const current = { ...state, houseParams: node.client.state.params, pricingCurrent: true };
    const check = ticketLevels(current, live, order, { takeProfit: "1000000", stopLoss: "1" }, { prices: prices(market.mark), limits: null });
    expect(check?.problems.take_profit).toBeNull();
    expect(ticketLevels(current, live, order, { takeProfit: "1", stopLoss: "" }, { prices: prices(market.mark), limits: null })?.problems.take_profit).toContain(`While the closing price is an estimate, a take profit on a long position must be above the market price, which is currently ${formatMark(market.mark ?? 0n, 2)},`);
    expect(ticketLevels(current, market, order, { takeProfit: "1", stopLoss: "" }, { prices: prices(market.mark), limits: null })?.problems.take_profit).toContain("must be above the price at which the position would close");
    expect(ticketLevels(current, live, order, { takeProfit: "", stopLoss: "1000000" }, { prices: prices(market.mark), limits: null })?.problems.stop_loss).toMatch(/^Stop loss above the closing price\. In this market, a stop loss on a long position must be below the price at which the position would close/);
  });

  it("holds a market order's new levels while the trading terms are not current, as their closing price needs the stress level's", async () => {
    const { node, state, market } = await fixture();
    const order = { side: "buy" as const, qty: fixedFromInt(1), slippageBps: 25, resting: false, triggerPrice: null };
    const stale = { ...state, houseParams: node.client.state.params, pricingCurrent: false };
    const fields = { takeProfit: "", stopLoss: "1" };
    expect(ticketLevels(stale, market, order, fields, { prices: prices(market.mark), limits: null })).toMatchObject({
      blocked: true, general: "The take profit and stop loss cannot be checked at the moment. The trading terms have changed. The new terms are loading.",
    });
    // Before the first read of the terms, the note says the levels wait for them.
    expect(ticketLevels({ ...state, houseParams: null }, market, order, fields, { prices: prices(market.mark), limits: null })?.general).toBe("The take profit and stop loss cannot be checked at the moment. They will be checked once the trading terms have loaded.");
    // A working order's levels are measured from its own price, which needs no terms.
    const resting = { ...order, resting: true, triggerPrice: fixedFromInt(50_000) };
    expect(ticketLevels(stale, market, resting, fields, { prices: prices(market.mark), limits: null })?.general).toBeNull();
  });
});

describe("closingExact", () => {
  it("knows the mock's own close is the engine's, and no close it prices for a live node, which may cap the close below even the first band's charge", async () => {
    const { market } = await fixture();
    expect(closingExact(market)).toBe(true);
    expect(closingExact({ ...market, ceilingBps: null })).toBe(false);
  });
});

describe("editorReference", () => {
  const live = async () => ({ ...(await fixture()).market, ceilingBps: null });
  const params = createMockNode(START).client.state.params;

  it("takes the node's exact close where it quotes one", async () => {
    expect(editorReference(null, null, await live(), fixedFromInt(1), fixedFromInt(66_000))).toEqual({ closing: fixedFromInt(66_000), capped: null });
  });

  it("prices its own close at the mark while the market is shut, with the mark for a take profit", async () => {
    const shut = { ...(await live()), open: false };
    expect(editorReference(null, params, shut, fixedFromInt(1), null)).toEqual({ closing: closingAt(shut, fixedFromInt(1), { tiers: shut.view.spread_tiers, stress: CALM, toxicityBps: 0 }), capped: shut.mark });
  });

  it("measures a live take profit from the mark wherever the close is its own, however small the position, and the mock's from its close", async () => {
    const { market } = await fixture();
    // 0.01 BTC is far inside the first band, yet a live node may cap its close nearer the mark than the console prices it.
    const small = editorReference(null, params, { ...market, ceilingBps: null }, q("0.01"), null);
    expect(small.capped).toBe(market.mark);
    expect(small.closing).not.toBeNull();
    expect(editorReference(null, params, market, q("0.01"), null).capped).toBeNull();
  });

  it("has nothing to measure from in an open market with no live price, which the engine refuses levels in", async () => {
    const unpriced = { ...(await live()), view: { ...(await live()).view, pricing: { priced: false, unpriced: "too_few_sources" as const, as_of_ms: 0, fresh_sources: 0, min_sources: 2, sources: [] } } };
    expect(editorReference(null, params, unpriced, fixedFromInt(1), null)).toEqual({ closing: null, capped: null });
  });

  it("prices no close of its own while the trading terms are not current, as it cannot know the stress level's or the tier's", async () => {
    expect(editorReference(null, null, { ...(await live()), open: false }, fixedFromInt(1), null)).toEqual({ closing: null, capped: null });
    expect(editorReference(null, null, await live(), fixedFromInt(1), fixedFromInt(66_000)).closing).toBe(fixedFromInt(66_000));
  });
});
