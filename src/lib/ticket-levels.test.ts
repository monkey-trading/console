/** Tests for the deal ticket's levels from the console's state: the closing price they are measured from, and the account's slots. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { createMockNode } from "./mock";
import { closingPrice } from "./mock/levels";
import { decodeMarket } from "./models";
import { CALM } from "./pricing";
import { formatMark } from "./price-format";
import { initialState } from "./store/state";
import { closingAt, ticketLevels } from "./ticket-levels";
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
  it("measures a market order's levels from the closing price of the position it leaves, an add's from the larger position", async () => {
    const { state, market } = await fixture();
    const account = heldIn(market, "1");
    const order = { side: "buy" as const, qty: fixedFromInt(1), slippageBps: 25, resting: false, triggerPrice: null };
    const prices = { bid: null, offer: null, price: market.mark, exactClose: false, toxicityBps: 0, spreadTenths: null, problem: null, problemIsSize: false };
    const check = ticketLevels({ ...state, account }, market, order, { takeProfit: "1", stopLoss: "" }, { prices, limits: null });
    const reference = closingAt(market, fixedFromInt(2), { tiers: market.view.spread_tiers, stress: CALM, toxicityBps: 0 });
    if (reference === null) throw new Error("the larger long has a closing price");
    expect(check?.problems.take_profit).toContain(`which is currently ${formatMark(reference, 2)},`);
  });
});
