/**
 * The mock node's portfolio margin under the dev grid (BTC-USD loading 1 and ETH-USD loading 1.25, 0.2% residuals, a 50% floor
 * share and 30 bp ceilings): the account read, withdrawals, the admission of new risk and of a reducing order, and the preview.
 */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { fixedFromInt, fixedFromWire, type Fixed } from "../fixed";
import { withdrawable } from "./funds";
import type { MockNode } from "./index";
import { auth, funded, ME, order, types } from "./test-helpers";

/** `ME` funded with `dollars`, BTC-USD at 100,000 and ETH-USD at 4,000, holding each of `held` (market, signed units) entered at its mark. */
async function book(dollars: number, held: [number, number][]): Promise<MockNode> {
  const node = await funded(dollars);
  const { state } = node.client;
  const prices: Record<number, Fixed> = { 1: fixedFromInt(100_000), 2: fixedFromInt(4_000) };
  for (const [id, price] of Object.entries(prices)) {
    const market = state.markets.get(Number(id));
    if (market !== undefined) market.mid = price;
  }
  for (const [id, qty] of held) state.account(ME).positions.set(id, { qty: fixedFromInt(qty), entry: state.markets.get(id)?.mid ?? 0n, openedAt: state.now });
  return node;
}

/** 10 BTC long against 200 ETH short: $1M of loading-weighted exposure each way. */
const HEDGE: [number, number][] = [[1, 10], [2, -200]];

describe("the mock's portfolio requirement", () => {
  it("credits a hedged pair's matched exposure, at the market's bands and at the tier's floor", async () => {
    // Bands of $47,000 and $37,000 at the market's, $50,000 and $40,000 at tier 0's 5% floor; the matched part's grid charge is 0.8%, $14,400, so the
    // credit is half the bands each time: $42,000 and $45,000.
    const view = await (await book(100_000, HEDGE)).client.account(ME);
    expect([view.margin, view.initial_margin, view.maintenance_margin]).toEqual(["84000", "45000", "21000"]);
    expect(view.portfolio_margin).toEqual({
      margin: "42000", initial_margin: "45000", maintenance_margin: "21000",
      groups: { crypto: { members: [1, 2], net_notional: "0", matched_notional: "2000000", worst_loss: "3600", binding_direction: "either", offset: "42000" } },
    });
  });

  it("names a group held on one side with nothing matched, and no group for a book outside the grid", async () => {
    const lone = await (await book(100_000, [[1, 10]])).client.account(ME);
    expect([lone.margin, lone.initial_margin, lone.maintenance_margin]).toEqual(["47000", "50000", "23500"]);
    expect(lone.portfolio_margin?.groups).toEqual({ crypto: { members: [1], net_notional: "1000000", matched_notional: "0", worst_loss: "0", binding_direction: "down", offset: "0" } });
    const fx = await (await book(100_000, [[3, 10_000]])).client.account(ME);
    expect(fx.portfolio_margin?.groups).toEqual({});
  });

  it("gives a group no credit at initial bands while a member it holds cannot trade, and keeps it at the market's", async () => {
    const node = await book(100_000, HEDGE);
    node.controls.setHalted(2, true);
    const view = await node.client.account(ME);
    expect([view.portfolio_margin?.margin, view.portfolio_margin?.initial_margin]).toEqual(["42000", "90000"]);
  });

  it("lets a hedged account withdraw down to its portfolio requirement", async () => {
    const node = await book(60_000, HEDGE);
    expect(withdrawable(node.client.state, ME)).toBe(fixedFromInt(15_000));
  });
});

describe("the mock's admission under the grid", () => {
  it("admits a hedge that per-position margin would refuse, and refuses the same size on the same side", async () => {
    // On $60,000, BTC alone needs $50,000 at tier 0's floor; ETH short beside it needs $45,000 in all, ETH long $90,000.
    const hedged = await book(60_000, [[1, 10]]);
    expect(types((await order(hedged, "200", "sell", {}, 2)).events)).toEqual(["order_accepted", "fill"]);
    const doubled = await book(60_000, [[1, 10]]);
    const refused = (await order(doubled, "200", "buy", {}, 2)).events[0];
    expect(refused).toMatchObject({ type: "order_rejected", reason: { kind: "insufficient_margin", required: "90000" } });
  });

  it("refuses an order closing one leg where the lone leg needs more than the equity, and lets a close-all close it", async () => {
    const node = await book(47_000, HEDGE);
    const lone = await order(node, "200", "buy", { reduce_only: true }, 2);
    expect(lone.events).toEqual([{ type: "order_rejected", account: ME, client_id: 1, reason: { kind: "insufficient_margin", equity: expect.any(String), required: "50000" } }]);
    const closed = await node.client.closeAll({ account: ME, closes: [{ market: 2, quoted: "4000" }], max_slippage_bps: 50, auth: auth(node) });
    expect(types(closed.events)).toEqual(["order_accepted", "fill"]);
    expect(node.client.state.account(ME).positions.has(2)).toBe(false);
  });

  it("never checks a reducing order that leaves the requirement no higher, even below it", async () => {
    // Closing half the BTC leg leaves $500k of it matched against ETH: $42,500 at tier 0's floor, more than $40,000 of equity, and less than $45,000 before.
    const node = await book(40_000, HEDGE);
    expect(types((await order(node, "5", "sell", { reduce_only: true }, 1)).events)).toEqual(["order_accepted", "fill"]);
  });

  it("fills a stop that closes a leg as it is placed, whatever the requirement it raises", async () => {
    const node = await book(47_000, HEDGE);
    const stop = await order(node, "200", "buy", { reduce_only: true, kind: { kind: "stop", price: "1" } }, 2);
    expect(types(stop.events)).toEqual(["order_accepted", "fill"]);
  });

  it("closes out in the same command an account a close-all leaves below its close-out level", async () => {
    // $30,000 covers the pair's $21,000 close-out level but not BTC alone's $23,500 once ETH is closed.
    const node = await book(30_000, HEDGE);
    node.client.state.account(ME).balance = fixedFromInt(23_000);
    const closed = await node.client.closeAll({ account: ME, closes: [{ market: 2, quoted: "4000" }], max_slippage_bps: 50, auth: auth(node) });
    expect(types(closed.events)).toEqual(["order_accepted", "fill", "close_out", "fill"]);
    expect(closed.events[3]).toMatchObject({ market: 1, liquidation: true });
  });
});

describe("the mock's order preview", () => {
  it("prices a hedging order and gives the account's figures after it", async () => {
    const node = await book(60_000, [[1, 10]]);
    const preview = await node.client.preview({ account: ME, market: 2, side: "sell", qty: "200", reduceOnly: false });
    expect(preview).toMatchObject({ market: 2, side: "sell", qty: "200", reduce_only: false, initial_margin: "45000", maintenance_margin: "21000", refused: null });
    expect(preview.fill).toMatchObject({ qty: "200", mid: "4000", increases: true });
    expect(fixedFromWire(preview.equity) < fixedFromInt(60_000)).toBe(true); // the spread paid
  });

  it("refuses a lone close with its fill and the requirement it would leave, and clamps a reduce-only size", async () => {
    const node = await book(47_000, HEDGE);
    const preview = await node.client.preview({ account: ME, market: 2, side: "buy", qty: "500", reduceOnly: true });
    expect(preview.fill).toMatchObject({ qty: "200", increases: false });
    expect(preview).toMatchObject({ initial_margin: "50000", maintenance_margin: "23500", refused: { kind: "insufficient_margin", required: "50000" } });
  });

  it("leaves no fill for an order that does not price, the account as it is, and answers 404 for an account never credited", async () => {
    const node = await book(60_000, HEDGE);
    const unknown = await node.client.preview({ account: ME, market: 99, side: "buy", qty: "1", reduceOnly: false });
    expect(unknown).toMatchObject({ fill: null, equity: "60000", initial_margin: "45000", maintenance_margin: "21000", refused: { kind: "unknown_market" } });
    const empty = await node.client.preview({ account: ME, market: 3, side: "buy", qty: "1", reduceOnly: true });
    expect(empty).toMatchObject({ fill: null, refused: { kind: "reduce_only" } });
    await expect(node.client.preview({ account: "0x00000000000000000000000000000000000000ff", market: 1, side: "buy", qty: "1", reduceOnly: false })).rejects.toEqual(new EngineError(404, "not found"));
  });
});
