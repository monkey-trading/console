/** Tests for portfolio margin at the deal ticket and the Close buttons: which orders are previewed, and what the answer shows. */

import { describe, expect, it } from "vitest";

import type { OrderPreviewWire, PortfolioGridWire } from "./engine/portfolio-types";
import type { MarketQuote } from "./engine/types";
import { fixedFromInt } from "./fixed";
import type { AccountModel, MarketModel } from "./models";
import type { PortfolioModel } from "./portfolio";
import { TRIGGERED_LEVELS_NOTE, TRIGGERED_ORDER_NOTE } from "./portfolio-words";
import { initialState, type ConsoleState } from "./store/state";
import { btcAt, q } from "./ticket-fixtures";
import { closeDeclined, closeRequests, offsetTicket, previewKey, previewRequest, requestOfKey, triggeredNote } from "./ticket-portfolio";

const WALLET = "0x00000000000000000000000000000000000000aa";
/** The dev genesis's fixture group: BTC-USD loading 1 and ETH-USD loading 1.25. */
const GRID: PortfolioGridWire = { groups: [{ name: "crypto", floor_share_bps: 5_000, max_floor_share_bps: 10_000, members: [{ market: 1, loading: "1", residual_shock_bps: 20, max_residual_shock_bps: 80 }, { market: 2, loading: "1.25", residual_shock_bps: 20, max_residual_shock_bps: 80 }] }] };
const HEDGED: PortfolioModel = { margin: fixedFromInt(8_000), initialMargin: fixedFromInt(8_000), maintenanceMargin: fixedFromInt(4_000), groups: [{ name: "crypto", members: [1, 2], netNotional: fixedFromInt(25_000), matchedNotional: fixedFromInt(200_000), offset: fixedFromInt(1_000) }] };
const LONE: PortfolioModel = { ...HEDGED, groups: [{ name: "crypto", members: [1], netNotional: fixedFromInt(100_000), matchedNotional: 0n, offset: 0n }] };

const position = (market: number, qty: string) => ({ market, qty: q(qty), entry: 0n, closeout: null, closeFee: null });
/** An account holding `held`, with an initial margin of $10,000, and a portfolio read when given. */
const holding = (held: [number, string][], portfolio?: PortfolioModel): AccountModel => ({
  balance: fixedFromInt(50_000), unfinalised: 0n, equity: fixedFromInt(50_000), margin: fixedFromInt(9_000), orders: [], positions: held.map(([m, qty]) => position(m, qty)),
  requirements: { initialMargin: fixedFromInt(10_000), maintenanceMargin: fixedFromInt(4_500), withdrawable: 0n, maxLeverage: new Map() },
  ...(portfolio === undefined ? {} : { portfolio }),
});

/** BTC-USD at 100,000 and ETH-USD (id 2) at 4,000, with EUR-USD (id 3) in no group. */
async function markets(): Promise<MarketModel[]> {
  const btc = await btcAt(100_000);
  return [btc, { ...btc, id: 2, symbol: "ETH-USD", mark: fixedFromInt(4_000), view: { ...btc.view, id: 2, symbol: "ETH-USD" } }, { ...btc, id: 3, symbol: "EUR-USD", mark: q("1.1"), view: { ...btc.view, id: 3, symbol: "EUR-USD" } }];
}

async function state(account: AccountModel | null, extra: Partial<ConsoleState> = {}): Promise<ConsoleState> {
  const listed = await markets();
  const base = initialState(listed.map((m) => m.view), { cash: "0", nav: "0", gross_exposure: "0" }, 0, () => [], "checked");
  return { ...base, markets: listed, account, wallet: { address: WALLET, label: "test" }, houseParams: { profitFeeBps: 1_000, closeoutLevelBps: 5_000, totalCapBps: 20_000, totalCapFloor: 0n, stressLevels: [], profitFeeCurve: [], portfolioGrid: GRID, seq: 1 }, ...extra };
}

const order = (side: "buy" | "sell", qty: string, resting = false) => ({ side, qty: q(qty), resting });
const marketOf = async (id: number) => (await markets()).find((m) => m.id === id) ?? (() => { throw new Error(`no market ${id}`); })();

describe("which ticket orders the server previews", () => {
  it("previews none for an account with one unhedged position adding to it, in its group or out of any", async () => {
    const lone = await state(holding([[1, "1"]], LONE));
    expect(previewRequest(lone, await marketOf(1), order("buy", "1"))).toBeNull();
    expect(previewRequest(lone, await marketOf(3), order("sell", "1000"))).toBeNull();
  });

  it("previews an order that would create a hedge, sized and sided exactly as the ticket holds it", async () => {
    const lone = await state(holding([[1, "1"]], LONE));
    expect(previewRequest(lone, await marketOf(2), order("sell", "10"))).toEqual({ account: WALLET, market: 2, side: "sell", qty: "10", reduceOnly: false });
  });

  it("previews any market order in a hedge that earns an offset, even one adding to its larger side", async () => {
    const hedged = await state(holding([[1, "1"], [2, "-10"]], HEDGED));
    expect(previewRequest(hedged, await marketOf(1), order("buy", "1"))?.market).toBe(1);
    expect(previewRequest(hedged, await marketOf(2), order("buy", "10"))?.side).toBe("buy");
  });

  it("previews nothing for a resting order, an empty size, no wallet, or no grid to tell a new hedge by", async () => {
    const lone = holding([[1, "1"]], LONE);
    const eth = await marketOf(2);
    expect(previewRequest(await state(lone), eth, order("sell", "10", true))).toBeNull();
    expect(previewRequest(await state(lone), eth, order("sell", "0"))).toBeNull();
    expect(previewRequest(await state(lone, { wallet: null }), eth, order("sell", "10"))).toBeNull();
    expect(previewRequest(await state(lone, { houseParams: null }), eth, order("sell", "10"))).toBeNull();
  });
});

const answer = (over: Partial<OrderPreviewWire>): OrderPreviewWire => ({
  seq: 7, account: WALLET, market: 1, side: "sell", qty: "1", reduce_only: false, fill: { qty: "1", price: "99990", mid: "100000", spread_bps: 1, increases: true },
  equity: "50000", initial_margin: "20000", maintenance_margin: "8000", refused: null, ...over,
});

describe("what the ticket shows from the server's preview", () => {
  const account = holding([[1, "1"], [2, "-10"]], HEDGED);

  it("shows nothing while the answer is awaited or after a failed read, so the other verdicts stand", () => {
    expect(offsetTicket(undefined, account)).toEqual({ line: null, refusal: null, useBps: null, answered: false });
    expect(offsetTicket("failed", account)).toEqual({ line: null, refusal: null, useBps: null, answered: false });
  });

  it("states the initial margin and equity an admitted order leaves, and their ratio for the margin use", () => {
    expect(offsetTicket(answer({}), account)).toEqual({ line: "After this order, your initial margin would be $20,000.00 and your equity $50,000.00.", refusal: null, useBps: 4_000, answered: true });
  });

  it("says when an order that reduces a hedge raises the initial margin, from the account's own", () => {
    const reducing = answer({ fill: { qty: "1", price: "99990", mid: "100000", spread_bps: 1, increases: false }, initial_margin: "24000", equity: "49000" });
    expect(offsetTicket(reducing, account).line).toBe("This order reduces a hedge, so your initial margin would rise from $10,000.00 to $24,000.00, with equity of $49,000.00.");
  });

  it("refuses for margin with the exact figures, pointing a reducing order to Close hedge", () => {
    const refused = { kind: "insufficient_margin" as const, equity: "20000", required: "24000" };
    const reducing = answer({ fill: { qty: "1", price: "99990", mid: "100000", spread_bps: 1, increases: false }, refused });
    expect(offsetTicket(reducing, account)).toMatchObject({ line: null, refusal: "Insufficient margin. This order requires $24,000.00 of margin, and your equity is $20,000.00. To close the whole hedge, use Close hedge in the positions panel.", answered: true });
    expect(offsetTicket(answer({ refused }), account).refusal).toBe("Insufficient margin. This order requires $24,000.00 of margin, and your equity is $20,000.00.");
  });

  it("leaves a refusal other than for margin to the ticket's own checks, stating no figures", () => {
    expect(offsetTicket(answer({ fill: null, refused: { kind: "market_closed" } }), account)).toMatchObject({ line: null, refusal: null, answered: true });
  });
});

describe("the note on an order that waits for a trigger", () => {
  const hedged = holding([[1, "1"], [2, "-10"]], HEDGED);

  it("explains a limit or stop that would reduce a hedged position, and levels on any order there", () => {
    expect(triggeredNote(hedged, 1, { side: "sell", resting: true }, false)).toBe(TRIGGERED_ORDER_NOTE);
    expect(triggeredNote(hedged, 1, { side: "buy", resting: true }, false)).toBeNull();
    expect(triggeredNote(hedged, 1, { side: "buy", resting: true }, true)).toBe(TRIGGERED_LEVELS_NOTE);
    expect(triggeredNote(hedged, 2, { side: "buy", resting: false }, true)).toBe(TRIGGERED_LEVELS_NOTE);
  });

  it("says nothing for an account that earns no offset, or a market outside its hedge", () => {
    expect(triggeredNote(holding([[1, "1"]], LONE), 1, { side: "sell", resting: true }, true)).toBeNull();
    expect(triggeredNote(hedged, 3, { side: "sell", resting: true }, true)).toBeNull();
  });
});

describe("a close the node declines", () => {
  const quote = (close: MarketQuote["close"]): MarketQuote => ({ type: "quote", account: WALLET, market: 1, open: true, reduce_only: false, stress_level: 0, mark: "100000", ask: [], bid: [], close });

  it("reads the exact close quote's reason only for the whole position on its side", () => {
    const declined = { kind: "insufficient_margin" as const, equity: "1", required: "2" };
    expect(closeDeclined(quote({ side: "sell", qty: "1", price: "99990", declined }), "sell", q("1"))).toEqual(declined);
    expect(closeDeclined(quote({ side: "sell", qty: "1", price: "99990", declined }), "sell", q("0.5"))).toBeNull();
    expect(closeDeclined(quote({ side: "sell", qty: "1", price: "99990" }), "sell", q("1"))).toBeNull();
    expect(closeDeclined(undefined, "sell", q("1"))).toBeNull();
  });

  it("asks a simulated build's node about each hedged position's whole close, and a live node nothing", async () => {
    const account = holding([[1, "1"], [2, "-10"], [3, "1000"]], HEDGED);
    expect(closeRequests(await state(account, { signatures: "none" }))).toEqual([
      { account: WALLET, market: 1, side: "sell", qty: "1", reduceOnly: true }, { account: WALLET, market: 2, side: "buy", qty: "10", reduceOnly: true },
    ]);
    expect(closeRequests(await state(account))).toEqual([]);
  });

  it("keys each request so its key gives it back, and refuses a key it did not make", () => {
    const request = { account: WALLET, market: 2, side: "buy" as const, qty: "10", reduceOnly: true };
    expect(requestOfKey(previewKey(request))).toEqual(request);
    expect(() => requestOfKey("nonsense")).toThrow("not a preview key");
  });
});
