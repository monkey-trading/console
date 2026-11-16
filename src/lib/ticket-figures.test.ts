/** Tests for the deal ticket's figures from the console's state: its prices and its close preview, live and on the mock. */

import { describe, expect, it } from "vitest";

import type { MarketQuote } from "./engine/types";
import { fixedFromInt } from "./fixed";
import { LAUNCH_CURVE } from "./holding-fee";
import type { HouseParams } from "./house";
import type { AccountModel, MarketModel } from "./models";
import { initialState, type ConsoleState } from "./store/state";
import { btcAt, heldIn, NAV, q, quotedIn } from "./ticket-fixtures";
import { currentParams, houseTermsNote, positionClose, positionFeeNow, ticketFigures, type TicketOrder } from "./ticket-figures";
import { ladderSlack } from "./close-preview";
import { conversionAt, USD } from "./pricing";

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

describe("a partial close's bound in a market quoted in yen", () => {
  it("moves the covering step by the rounding slack counted through the multiplier and the conversion from USD", async () => {
    const market = await quotedIn("jpy", 30_000, "150");
    const held = { ...heldIn(market, "2"), positions: [{ market: 9, qty: q("2"), entry: q("30000"), closeout: null, closeFee: null }] };
    const quote: MarketQuote = { ...QUOTE, market: 9, mark: "30000", bid: [{ qty: "1", price: "29990" }], close: { side: "sell", qty: "2", price: "29989" } };
    const params = { ...PARAMS, stressLevels: [{ size_spread_multiplier_bps: 25_000, min_spread_bps: 0 }] };
    const figures = ticketFigures(state(market, true, { account: held, houseParams: params, quotes: { 9: quote } }), market, order("1"));
    const slack = ladderSlack(q("1"), market.view.spread_tiers.length, 25_000, conversionAt(market.view, q("30000")) ?? USD);
    // 150 yen per USD unit, at 2.5x: far more than the raw units of yen the old count allowed.
    expect(slack).toBeGreaterThan(ladderSlack(q("1"), market.view.spread_tiers.length, 10_000, USD) * 100n);
    expect(figures.close).toMatchObject({ exact: false, price: q("29990") - slack });
  });
});

describe("the close summary's state", () => {
  it("is present for an order that closes some of the position, and carries the reason while its figures are withheld", async () => {
    const market = await btcAt(101_000);
    const shown = ticketFigures(state(market, true), market, order("1"));
    expect([shown.closing?.whole, shown.close === null, shown.closeWithheld]).toEqual([false, false, null]);
    const unread = ticketFigures(state(market, true, { pricingCurrent: false, houseStateStatus: "failed" }), market, order("1"));
    expect([unread.closing?.closed, unread.close, unread.closeWithheld]).toEqual([q("1"), null, "The trading terms changed and couldn't be reloaded. The page will try again by itself."]);
    // With no quote yet the figures are withheld too, and still say so.
    const unquoted = ticketFigures(state(market, true, { quotes: {} }), market, order("1"));
    expect([unquoted.closing === null, unquoted.close, typeof unquoted.closeWithheld]).toEqual([false, null, "string"]);
  });

  it("is absent for a resting order, an order on the position's own side, and no size", async () => {
    const market = await btcAt(101_000);
    const none = (extra: Partial<TicketOrder>) => ticketFigures(state(market, true), market, { ...order("1"), ...extra });
    for (const figures of [none({ resting: true, triggerPrice: q("100000") }), none({ side: "buy" }), none({ qty: 0n })]) expect([figures.closing, figures.closeWithheld]).toEqual([null, null]);
  });
});

describe("positionClose", () => {
  const position = () => { const p = HOLDING.positions[0]; if (p === undefined) throw new Error("no position"); return p; };

  it("states nothing for a position in a closed market, whatever the mock's price, as its Close button is off", async () => {
    const market = { ...(await btcAt(101_000)), open: false };
    expect(positionClose(state(market, false), market, position(), q("100979.8"))).toEqual({ close: null, why: null });
    const open = await btcAt(101_000);
    expect(positionClose(state(open, false), open, position(), q("100979.8")).close).not.toBeNull();
  });

  it("says why while the house state held is not current", async () => {
    const market = await btcAt(101_000);
    expect(positionClose(state(market, true, { pricingCurrent: false, houseStateStatus: "read" }), market, position(), q("100979.8"))).toEqual({ close: null, why: "The trading terms changed. Loading the new ones." });
  });
});

describe("the account's fee discount at a close, from V68", () => {
  /** A holding whose curve has run, so a close pays the base: the parameters' 10% less the tier's discount. */
  const discounted = (feeDiscountBps: number | null): AccountModel => ({
    ...HOLDING,
    volume: { tier: 2, matured: 0n, pending: 0n, progress: [], bestPriceBounds: new Map(), maxRestingOrders: null, requestsPerSecond: null, feeDiscountBps, financingDiscountBps: null, emissionsBoostBps: null },
  });

  it("runs the rate from the discounted base under the same curve, so a hold the curve prices higher still pays the curve", async () => {
    const market = await btcAt(101_000);
    const at = (now: number, d: number | null) => positionFeeNow(state(market, true, { now, account: discounted(d) }), HOLDING.positions[0] ?? (() => { throw new Error("no position"); })())?.feeBps;
    expect([at(OPENED + 900_000, 2_000), at(OPENED + 900_000, 1_000), at(OPENED + 900_000, null)]).toEqual([800, 900, 1_000]);
    expect(at(OPENED + 60_000, 2_000)).toBe(6_421);
  });

  it("gives a whole close's preview the discounted rate, and the same one for close-all's figures", async () => {
    const market = await btcAt(101_000);
    const base = state(market, true, { now: OPENED + 900_000, account: discounted(2_000) });
    const { close } = ticketFigures(base, market, order("2"));
    expect(close).toMatchObject({ feeBps: 800 });
    expect(positionClose(base, market, HOLDING.positions[0] ?? (() => { throw new Error("no position"); })(), q("100979.8")).close).toMatchObject({ feeBps: 800 });
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
    expect(at({ houseParams: null, pricingCurrent: false, houseStateStatus: "failed" })).toEqual([null, "The trading terms couldn't be loaded. The page will try again by itself."]);
    expect(at({ houseParams: null, pricingCurrent: false, houseStateStatus: "unavailable" })).toEqual([null, "This server doesn't publish its trading terms."]);
    expect(at({ pricingCurrent: false, houseStateStatus: "read" })).toEqual([null, "The trading terms changed. Loading the new ones."]);
    expect(at({ pricingCurrent: false, houseStateStatus: "failed" })).toEqual([null, "The trading terms changed and couldn't be reloaded. The page will try again by itself."]);
  });
});

describe("the account's volume tier at the ticket", () => {
  const TABLE = [
    { threshold: "0", day_divisor: 1, best_price_share_bps: 2500, margin_floor_bps: 500, max_resting_orders: 25, requests_per_second: 2 },
    { threshold: "1000000", day_divisor: 2, best_price_share_bps: 5000, margin_floor_bps: 200, max_resting_orders: 50, requests_per_second: 5 },
  ];
  const tiered = (resting: number): AccountModel => ({
    ...HOLDING, positions: [], margin: 0n,
    orders: Array.from({ length: resting }, (_, i) => ({ order_id: i + 1, client_id: i, market: 1, side: "buy", qty: "1", kind: { kind: "limit", price: "1" }, reduce_only: false })),
    requirements: { initialMargin: 0n, maintenanceMargin: 0n, withdrawable: fixedFromInt(50_000), maxLeverage: new Map([[1, fixedFromInt(20)]]) },
    volume: { tier: 0, matured: 0n, pending: 0n, progress: [{ capped: 0n, days: 0 }, { capped: 0n, days: 0 }], bestPriceBounds: new Map([[1, fixedFromInt(500_000)]]), maxRestingOrders: 25, requestsPerSecond: 2, feeDiscountBps: null, financingDiscountBps: null, emissionsBoostBps: null },
  });
  const params = { ...PARAMS, volumeTiers: TABLE };

  it("gives the tier's limits in the market and stops a resting order at the limit, never a market order", async () => {
    const market = await btcAt(101_000);
    const resting = { ...order("1"), side: "buy" as const, resting: true, triggerPrice: q("100000") };
    const full = ticketFigures(state(market, true, { account: tiered(25), houseParams: params }), market, resting);
    expect(full.limits).toMatchObject({ tier: 0, bestPriceBound: fixedFromInt(500_000), leverage: fixedFromInt(20), orderLimit: 25, resting: 25 });
    expect(full.orderProblem).toContain("the most for volume tier 0");
    expect(ticketFigures(state(market, true, { account: tiered(24), houseParams: params }), market, resting).orderProblem).toBeNull();
    expect(ticketFigures(state(market, true, { account: tiered(25), houseParams: params }), market, { ...order("1"), side: "buy" }).orderProblem).toBeNull();
  });

  it("prices the mock's order at the account's first band and holds it to the tier's margin floor", async () => {
    const market = await btcAt(100_000);
    // 10 BTC is $1M: past the $500k a tier-0 account pays the first band for, so it costs more than at the listed band.
    const at = (extra: Partial<ConsoleState>) => ticketFigures(state(market, false, { account: tiered(0), ...extra }), market, { ...order("10"), side: "buy" });
    const tier0 = at({ houseParams: params });
    const listed = at({ houseParams: PARAMS });
    expect(tier0.prices.price).toBeGreaterThan(listed.prices.price ?? 0n);
    // $1M at the 5% floor needs $50k; at BTC's own 2% to $100k and 5% beyond it needs far less.
    expect(tier0.preview.marginAdded).toBe(fixedFromInt(50_000));
    expect(listed.preview.marginAdded).toBeLessThan(tier0.preview.marginAdded);
  });

  it("charges the margin figures at the weekend margin while it applies, as Max leverage does", async () => {
    const market = await btcAt(100_000);
    const weekend = (from: number, reopen: number) => ({ ...market, view: { ...market.view, weekend_margin: { weekend_margin_bps: 750, from, close: 7_200_000, reopen } } });
    const at = (m: MarketModel) => ticketFigures(state(m, false, { account: tiered(0), houseParams: params, now: 1_000 }), m, { ...order("10"), side: "buy" });
    // $1M at the tier's 5% floor needs $50k; inside the window the 7.5% weekend rate sets it.
    expect(at(market).preview.marginAdded).toBe(fixedFromInt(50_000));
    const inside = at(weekend(0, 1e13));
    expect(inside.preview.marginAdded).toBe(fixedFromInt(75_000));
    expect(inside.preview.marginRateBps).toBe(750);
    expect(inside.limits?.weekendSets).toBe(true);
    // Before the window opens, or after the reopen, the tier's floor stands.
    expect(at(weekend(2_000, 1e13)).preview.marginAdded).toBe(fixedFromInt(50_000));
    expect(at(weekend(0, 1_000)).preview.marginAdded).toBe(fixedFromInt(50_000));
  });

  it("names the tier's leverage in the in-browser node's margin refusal, and the weekend margin when it sets it", async () => {
    const market = await btcAt(100_000);
    // $10,000 of equity at the 5% floor opens $200,000: 3 BTC is $300,000.
    const poor = { ...tiered(0), equity: fixedFromInt(10_000), balance: fixedFromInt(10_000) };
    const refused = ticketFigures(state(market, false, { account: poor, houseParams: params }), market, { ...order("3"), side: "buy" });
    expect(refused.preview.problems).toContain("Not enough equity to cover the margin for this order. Volume tier 0 allows up to 20x leverage here.");
    const weekend = { ...market, view: { ...market.view, weekend_margin: { weekend_margin_bps: 750, from: 0, close: 7_200_000, reopen: 1e13 } } };
    const held = ticketFigures(state(weekend, false, { account: poor, houseParams: params, now: 1_000 }), weekend, { ...order("3"), side: "buy" });
    expect(held.preview.problems).toContain("Not enough equity to cover the margin for this order. Weekend margin applies here, which allows up to 20x leverage.");
  });

  it("gives the account's own spread bands, its first band ending at its best-price size, and the listed ones before the table is read", async () => {
    const market = await btcAt(100_000);
    const own = ticketFigures(state(market, false, { account: tiered(0), houseParams: params }), market, order("1"));
    expect([own.ownBands, own.spreadTiers[0]]).toEqual([true, expect.objectContaining({ up_to: "500000" })]);
    const listed = ticketFigures(state(market, false, { account: tiered(0), houseParams: PARAMS }), market, order("1"));
    expect([listed.ownBands, listed.spreadTiers]).toEqual([false, market.view.spread_tiers]);
  });

  it("has no limits from a node that predates volume tiers", async () => {
    const market = await btcAt(101_000);
    const figures = ticketFigures(state(market, true), market, order("1"));
    expect([figures.limits, figures.orderProblem]).toEqual([null, null]);
  });
});
