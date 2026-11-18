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
    const { state, market } = await fixture();
    // 20 BTC held and 20 more bought: with no tier table read the listing's first band applies, to $2,000,000, which at about
    // $67,000 a coin the larger long crosses and the held one does not, so the larger one closes at a lower price.
    const account = heldIn(market, "20");
    const order = { side: "buy" as const, qty: fixedFromInt(20), slippageBps: 25, resting: false, triggerPrice: null };
    const check = ticketLevels({ ...state, account }, market, order, { takeProfit: "1", stopLoss: "" }, { prices: prices(market.mark), limits: null });
    const terms = { tiers: market.view.spread_tiers, stress: CALM, toxicityBps: 0 };
    const left = closingAt(market, fixedFromInt(40), terms);
    const held = closingAt(market, fixedFromInt(20), terms);
    if (left === null || held === null) throw new Error("both longs have a closing price");
    expect(formatMark(left, 2)).not.toBe(formatMark(held, 2));
    expect(check?.problems.take_profit).toContain(`which is currently ${formatMark(left, 2)},`);
  });
});

describe("closingExact", () => {
  it("knows the mock's own close is the engine's, and a live close is only within the account's first band", async () => {
    const { market } = await fixture();
    const live = { ...market, ceilingBps: null };
    const tiers = accountSpreadTiers(market.view.spread_tiers, 2_500); // the first band ends at $500,000
    expect(closingExact(market, fixedFromInt(100), tiers)).toBe(true);
    expect(closingExact(live, q("7"), tiers)).toBe(true);
    expect(closingExact(live, fixedFromInt(8), tiers)).toBe(false);
    expect(closingExact(live, fixedFromInt(8), [{ up_to: null, tenth_bps: 20 }])).toBe(true);
  });
});

describe("editorReference", () => {
  const live = async () => ({ ...(await fixture()).market, ceilingBps: null });

  it("takes the node's exact close where it quotes one", async () => {
    expect(editorReference(null, null, await live(), fixedFromInt(1), fixedFromInt(66_000))).toEqual({ closing: fixedFromInt(66_000), capped: null });
  });

  it("prices its own close at the mark while the market is shut, with the mark for a take profit past the first band", async () => {
    const shut = { ...(await live()), open: false };
    const small = editorReference(null, null, shut, fixedFromInt(1), null);
    expect(small.capped).toBeNull();
    expect(small.closing).toBe(closingAt(shut, fixedFromInt(1), { tiers: shut.view.spread_tiers, stress: CALM, toxicityBps: 0 }));
    // With no tier table read the listing's first band applies, which ends at $2,000,000: 40 BTC is past it.
    expect(editorReference(null, null, shut, fixedFromInt(40), null).capped).toBe(shut.mark);
  });

  it("has nothing to measure from in an open market with no live price, which the engine refuses levels in", async () => {
    const unpriced = { ...(await live()), view: { ...(await live()).view, pricing: { priced: false, unpriced: "too_few_sources" as const, as_of_ms: 0, fresh_sources: 0, min_sources: 2, sources: [] } } };
    expect(editorReference(null, null, unpriced, fixedFromInt(1), null)).toEqual({ closing: null, capped: null });
  });
});
