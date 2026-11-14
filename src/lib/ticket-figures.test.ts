/** Tests for the deal ticket's figures from the console's state: its prices and its close preview, live and on the mock. */

import { describe, expect, it } from "vitest";

import type { MarketQuote } from "./engine/types";
import { fixedFromInt } from "./fixed";
import { LAUNCH_CURVE } from "./holding-fee";
import type { HouseParams } from "./house";
import type { AccountModel, MarketModel } from "./models";
import { initialState, type ConsoleState } from "./store/state";
import { btcAt, NAV, q } from "./ticket-fixtures";
import { currentParams, houseTermsNote, positionFeeNow, ticketFigures } from "./ticket-figures";

const OPENED = 1_000_000;
const PARAMS: HouseParams = { profitFeeBps: 1_000, closeoutLevelBps: 5_000, totalCapBps: 20_000, totalCapFloor: 0n, stressLevels: [{ size_spread_multiplier_bps: 10_000, min_spread_bps: 0 }], profitFeeCurve: [...LAUNCH_CURVE], seq: 1 };
/** A 2 BTC long opened at 100,000, whose account read gave a 100% rate falling 10 s after the open. */
const HOLDING: AccountModel = {
  balance: fixedFromInt(50_000), unfinalised: 0n, equity: fixedFromInt(50_000), margin: fixedFromInt(4_000), orders: [],
  positions: [{ market: 1, qty: fixedFromInt(2), entry: fixedFromInt(100_000), closeout: null, closeFee: { openedAt: OPENED, feeBps: 10_000, fallsAt: OPENED + 10_007 } }],
};
/** The node's quote for that account: a ladder whose 1-unit sell step covers a partial close, and the exact whole close. */
const QUOTE: MarketQuote = {
  type: "quote", account: "0xabc", market: 1, open: true, reduce_only: false, stress_level: 0, mark: "101000",
  ask: [{ qty: "5", price: "101020" }], bid: [{ qty: "1", price: "100970" }, { qty: "2", price: "100960" }], close: { side: "sell", qty: "2", price: "100979.8" },
};

/** The console's state over `market`, live or the mock's, with the holding, the parameters and the node's clock. */
function state(market: MarketModel, live: boolean, extra: Partial<ConsoleState> = {}): ConsoleState {
  const base = initialState([market.view], { cash: "0", nav: "0", gross_exposure: "0" }, 0, () => [], live ? "checked" : "none");
  return { ...base, markets: [market], house: { ...base.house, nav: NAV }, account: HOLDING, houseParams: PARAMS, pricingCurrent: true, now: OPENED + 900_000, quotes: live ? { 1: QUOTE } : {}, ...extra };
}

const order = (qty: string) => ({ side: "sell" as const, qty: q(qty), slippageBps: 25, resting: false, triggerPrice: null });

describe("ticketFigures", () => {
  it("prices a live whole close at the node's close quote, exact at the base once the curve has run", async () => {
    const market = await btcAt(101_000);
    const { prices, close } = ticketFigures(state(market, true), market, order("2"));
    expect([prices.price, prices.exactClose]).toEqual([q("100979.8"), true]);
    // 2 x (100,979.8 - 100,000) realised, a tenth of it the fee.
    expect(close).toMatchObject({ whole: true, exact: true, feeBps: 1_000, realised: q("1959.6"), fee: q("195.96"), net: q("1763.64") });
  });

  it("bounds a live partial close at the ladder's covering step, less the engine's rounding slack for its size", async () => {
    const market = await btcAt(101_000);
    const { prices, close } = ticketFigures(state(market, true), market, order("1"));
    expect([prices.price, prices.exactClose]).toEqual([q("100970"), false]);
    // One unit through three bands: 9 raw units of slack.
    expect(close).toMatchObject({ whole: false, exact: false, price: q("100969.999999991"), realised: q("969.999999991") });
  });

  it("states no close while the house state held is not current, since a change to the fee may be unread", async () => {
    const market = await btcAt(101_000);
    expect(ticketFigures(state(market, true, { pricingCurrent: false }), market, order("2")).close).toBeNull();
  });

  it("takes the rate on the curve at the node's clock, a bound while it falls", async () => {
    const market = await btcAt(101_000);
    const { close } = ticketFigures(state(market, true, { now: OPENED + 60_000 }), market, order("2"));
    expect(close).toMatchObject({ feeBps: 6_421, exact: false });
  });

  it("prices the mock's close at its own price, which its fill uses, exactly", async () => {
    const market = await btcAt(101_000);
    const { prices, close } = ticketFigures(state(market, false), market, order("1"));
    expect(prices.exactClose).toBe(false);
    expect(close).toMatchObject({ exact: true, price: prices.price });
  });

  it("previews no close for a resting order, or for an order on the position's own side", async () => {
    const market = await btcAt(101_000);
    expect(ticketFigures(state(market, true), market, { ...order("1"), resting: true, triggerPrice: q("100000") }).close).toBeNull();
    expect(ticketFigures(state(market, true), market, { ...order("1"), side: "buy" }).close).toBeNull();
  });
});

describe("positionFeeNow", () => {
  it("runs the rate on the curve while the house state is current, and takes the account read's otherwise", async () => {
    const market = await btcAt(101_000);
    const position = HOLDING.positions[0];
    if (position === undefined) throw new Error("no position");
    expect(positionFeeNow(state(market, true, { now: OPENED + 60_000 }), position)).toMatchObject({ feeBps: 6_421, fallsAt: OPENED + 60_005 });
    expect(positionFeeNow(state(market, true, { now: OPENED + 60_000, pricingCurrent: false }), position)).toEqual({ holdMs: 60_000, feeBps: 10_000, fallsAt: OPENED + 10_007, baseAt: null });
  });
});

describe("the house state's terms on the trading surfaces", () => {
  it("are shown only while current, and say why when they are not: a failed or absent first read, an unread change, or a failed read since", async () => {
    const market = await btcAt(101_000);
    const at = (extra: Partial<ConsoleState>) => { const s = state(market, true, extra); return [currentParams(s) === null ? null : "params", houseTermsNote(s)]; };
    expect(at({})).toEqual(["params", null]);
    expect(at({ houseParams: null, pricingCurrent: false, houseStateStatus: "pending" })).toEqual([null, null]);
    expect(at({ houseParams: null, pricingCurrent: false, houseStateStatus: "failed" })).toEqual([null, "The node's parameters could not be read; the console reads them again by itself."]);
    expect(at({ houseParams: null, pricingCurrent: false, houseStateStatus: "unavailable" })).toEqual([null, "This node does not serve its parameters."]);
    expect(at({ pricingCurrent: false, houseStateStatus: "read" })).toEqual([null, "Reading the node's parameters again after a change."]);
    expect(at({ pricingCurrent: false, houseStateStatus: "failed" })).toEqual([null, "The node's parameters changed and could not be read again; the console reads them again by itself."]);
  });
});
