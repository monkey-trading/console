/** Tests for the deal ticket's margin verdict on an order that concerns a hedge: the server's preview overrules the ladder and the console's own estimate. */

import { describe, expect, it } from "vitest";

import type { OrderPreviewWire } from "./engine/portfolio-types";
import type { MarketQuote } from "./engine/types";
import { fixedFromInt } from "./fixed";
import type { AccountModel, MarketModel } from "./models";
import { initialState, type ConsoleState } from "./store/state";
import { MARGIN_SHORT } from "./ticket";
import { btcAt, NAV, q } from "./ticket-fixtures";
import { ticketFigures } from "./ticket-figures";

/** A 1 BTC long with $1,000 of equity, too little for the ladder's 5-unit step. */
const ACCOUNT: AccountModel = { balance: fixedFromInt(1_000), unfinalised: 0n, equity: fixedFromInt(1_000), margin: fixedFromInt(2_000), orders: [], positions: [{ market: 1, qty: fixedFromInt(1), entry: fixedFromInt(100_000), closeout: null, closeFee: null }] };
/** The node's ladder declines its 5-unit step for margin, and admits its 1-unit step. */
const QUOTE: MarketQuote = {
  type: "quote", account: "0xabc", market: 1, open: true, reduce_only: false, stress_level: 0, mark: "100000",
  ask: [{ qty: "1", price: "100010" }, { qty: "5", price: "100020", declined: { kind: "insufficient_margin", equity: "1000", required: "9000" } }], bid: [{ qty: "5", price: "99990" }], close: { side: "sell", qty: "1", price: "99990" },
};
const ADMITTED: OrderPreviewWire = {
  seq: 9, account: "0xabc", market: 1, side: "buy", qty: "3", reduce_only: false, fill: { qty: "3", price: "100020", mid: "100000", spread_bps: 2, increases: true },
  equity: "940", initial_margin: "470", maintenance_margin: "200", refused: null,
};
const REFUSED: OrderPreviewWire = { ...ADMITTED, refused: { kind: "insufficient_margin", equity: "940", required: "6000" } };

function state(market: MarketModel, live: boolean): ConsoleState {
  const base = initialState([market.view], { cash: "0", nav: "0", gross_exposure: "0" }, 0, () => [], live ? "checked" : "none");
  return { ...base, markets: [market], house: { ...base.house, nav: NAV }, account: ACCOUNT, pricingCurrent: true, quotes: live ? { 1: QUOTE } : {} };
}

const BUY_3 = { side: "buy" as const, qty: q("3"), slippageBps: 25, resting: false, triggerPrice: null };
const LARGEST = "Insufficient margin for this order size. With your current equity, the largest order you can place is approximately 1 contract.";

describe("a live ticket's margin verdict", () => {
  it("names the largest order the ladder admits for an order that concerns no hedge, as before", async () => {
    const market = await btcAt(100_000);
    expect(ticketFigures(state(market, true), market, BUY_3).prices).toMatchObject({ problem: LARGEST, problemIsSize: true, marginDeclined: true });
  });

  it("states no margin verdict while a hedge's preview is awaited, and none once it admits the size", async () => {
    const market = await btcAt(100_000);
    expect(ticketFigures(state(market, true), market, BUY_3, { answer: undefined }).prices.problem).toBeNull();
    const admitted = ticketFigures(state(market, true), market, BUY_3, { answer: ADMITTED });
    expect([admitted.prices.problem, admitted.preview.marginUseBps, admitted.offset?.line]).toEqual([null, 5_000, "After this order, your initial margin would be $470.00 and your equity $940.00."]);
  });

  it("shows the preview's refusal for the exact size under the size field", async () => {
    const market = await btcAt(100_000);
    expect(ticketFigures(state(market, true), market, BUY_3, { answer: REFUSED }).prices).toMatchObject({ problem: "Insufficient margin. This order requires $6,000.00 of margin, and your equity is $940.00.", problemIsSize: true });
  });

  it("says a failed preview could not check the margin, and states no margin verdict of the ladder's", async () => {
    const market = await btcAt(100_000);
    const failed = ticketFigures(state(market, true), market, BUY_3, { answer: "failed" });
    expect([failed.prices.problem, failed.offset?.line, failed.offset?.awaited]).toEqual([null, "The margin this order would leave could not be checked, and the check is being retried. The trading server checks the margin again when you place the order.", false]);
  });
});

describe("a simulated ticket's margin verdict", () => {
  const ownEstimate = (problems: readonly string[]) => problems.filter((p) => p.startsWith(MARGIN_SHORT));

  it("keeps its own estimate for an order that concerns no hedge, and drops it for one that does, whatever the preview", async () => {
    const market = await btcAt(100_000);
    expect(ownEstimate(ticketFigures(state(market, false), market, BUY_3).preview.problems)).toHaveLength(1);
    expect(ownEstimate(ticketFigures(state(market, false), market, BUY_3, { answer: "failed" }).preview.problems)).toEqual([]);
  });

  it("drops its own estimate, which swaps one position's margin, for the in-browser node's preview", async () => {
    const market = await btcAt(100_000);
    const awaited = ticketFigures(state(market, false), market, BUY_3, { answer: undefined });
    const refused = ticketFigures(state(market, false), market, BUY_3, { answer: REFUSED });
    expect([ownEstimate(awaited.preview.problems), ownEstimate(refused.preview.problems), refused.prices.problem]).toEqual([[], [], "Insufficient margin. This order requires $6,000.00 of margin, and your equity is $940.00."]);
  });
});
