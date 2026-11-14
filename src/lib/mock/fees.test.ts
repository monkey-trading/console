/** Tests for the mock's pricing and fee as the engine charges them from V52 and V55: the bands on both fills, the ceiling, and the hold clock. */

import { describe, expect, it } from "vitest";

import type { EngineEvent, Fill } from "../engine/types";
import { fixedFromInt, fixedToWire, parseFixed } from "../fixed";
import { LAUNCH_CURVE } from "../holding-fee";
import { liveQuote } from "./execute";
import type { MockNode } from "./index";
import { funded, ME, order, START } from "./test-helpers";

/** Holds BTC-USD's index at `dollars`, so a test's fills price from a known mid. */
function pin(node: MockNode, dollars: number): void {
  const runtime = node.client.state.markets.get(1);
  if (runtime === undefined) throw new Error("the mock lists BTC-USD");
  runtime.mid = fixedFromInt(dollars);
}

/** The one fill among `events`. */
function fillOf(events: EngineEvent[]): Fill {
  const fills = events.flatMap((e) => (e.type === "fill" ? [e] : []));
  if (fills.length !== 1) throw new Error(`expected one fill, got ${fills.length}`);
  const [fill] = fills;
  if (fill === undefined) throw new Error("no fill");
  return fill;
}

/** A market order of `qty` BTC-USD at the mock's own price, so no slippage bound refuses it. */
async function trade(node: MockNode, qty: string, side: "buy" | "sell"): Promise<Fill> {
  const units = parseFixed(qty);
  if (units === null) throw new Error(`bad size ${qty}`);
  const priced = liveQuote(node.client.state, ME, 1, side, units);
  if (priced === null || priced.kind === "refused") throw new Error("no price");
  return fillOf((await order(node, qty, side, { kind: { kind: "market", quoted: fixedToWire(priced.price), max_slippage_bps: 0 } })).events);
}

describe("the mock's spreads, as the engine charges them from V52", () => {
  it("charges a round trip BTC-USD's first band on the open and again on the close, and names the spread in whole bps", async () => {
    const node = await funded(100_000);
    pin(node, 100_000);
    // $100k at 2 bps, 20 a unit, each way.
    const open = await trade(node, "1", "buy");
    const close = await trade(node, "1", "sell");
    expect([open.price, close.price, open.spread_bps, close.spread_bps]).toEqual(["100020", "99980", 2, 2]);
  });

  it("clamps a pure close to the market's ceiling at the highest stress level, which an opening order pays in full", async () => {
    const node = await funded(100_000);
    const { state } = node.client;
    pin(node, 100_000);
    const runtime = state.markets.get(1);
    if (runtime === undefined) throw new Error("no BTC-USD");
    runtime.stress = 2;
    // A $50m long: closing it pays (400 + 3,200 + 32,000) x4, 284.8 a unit, plus the level's 10 bps: 38.48 bps, over the 30 bps ceiling.
    state.account(ME).positions.set(1, { qty: fixedFromInt(500), entry: fixedFromInt(100_000), openedAt: START });
    expect(liveQuote(state, ME, 1, "sell", fixedFromInt(500))).toEqual({ kind: "priced", price: fixedFromInt(99_700), spread: fixedFromInt(300), increases: false });
    // Adding $50m to it lies wholly past $10m: 8 bps x4 and the 10 bps minimum, 42 bps with no ceiling to clamp it.
    expect(liveQuote(state, ME, 1, "buy", fixedFromInt(500))).toMatchObject({ kind: "priced", price: fixedFromInt(100_420) });
    // A reversal over the ceiling is refused, as the engine refuses it.
    expect(liveQuote(state, ME, 1, "sell", fixedFromInt(501))).toEqual({ kind: "refused", reject: { kind: "close_spread_ceiling", ceiling_bps: 30 } });
  });
});

describe("a triggered reversal the close-spread ceiling refuses, in the mock", () => {
  /** A 0.01 BTC long at level 2, whose 500 BTC reversal pays 38.48 bps, past BTC-USD's 30 bps ceiling. */
  async function heldAtLevelTwo() {
    const node = await funded(100_000);
    pin(node, 100_000);
    await trade(node, "0.01", "buy");
    const runtime = node.client.state.markets.get(1);
    if (runtime === undefined) throw new Error("no BTC-USD");
    runtime.stress = 2;
    return node;
  }
  const kinds = (events: EngineEvent[]) => events.map((e) => (e.type === "fill" ? `fill ${e.qty} ${e.position}` : e.type === "order_cancelled" ? `cancelled ${e.reason}` : e.type));

  it("fills a stop's closing slice and cancels the rest, as the engine's fill_closing_slice does", async () => {
    const node = await heldAtLevelTwo();
    const result = await order(node, "500", "sell", { kind: { kind: "stop", price: "100001" } });
    expect(kinds(result.events)).toEqual(["order_accepted", "fill 0.01 0", "cancelled unfillable"]);
  });

  it("fills a limit's closing slice only within the limit, and cancels the order either way", async () => {
    // The closing slice sells at 18 bps under the index: 99,820.
    const within = await heldAtLevelTwo();
    expect(kinds((await order(within, "500", "sell", { kind: { kind: "limit", price: "99000" } })).events)).toEqual(["order_accepted", "fill 0.01 0", "cancelled unfillable"]);
    const beyond = await heldAtLevelTwo();
    expect(kinds((await order(beyond, "500", "sell", { kind: { kind: "limit", price: "99900" } })).events)).toEqual(["order_accepted", "cancelled unfillable"]);
    expect(beyond.client.state.account(ME).positions.get(1)?.qty).toBe(fixedFromInt(1) / 100n);
  });

  it("prices an oversized reduce-only limit as the close it is clamped to, so it rests until that close's price reaches the limit", async () => {
    const node = await heldAtLevelTwo();
    const result = await order(node, "500", "sell", { kind: { kind: "limit", price: "99900" }, reduce_only: true });
    expect(kinds(result.events)).toEqual(["order_accepted"]);
    expect([node.client.state.account(ME).orders.size, node.client.state.account(ME).positions.get(1)?.qty]).toEqual([1, fixedFromInt(1) / 100n]);
  });
});

describe("the mock's holding-time fee, as the engine charges it from V55", () => {
  it("takes all of a gain closed within ten seconds, the curve's rate after, and the base from fifteen minutes, naming each close's hold and rate", async () => {
    const node = await funded(1_000_000);
    const { state } = node.client;
    pin(node, 100_000);
    await trade(node, "1", "buy");
    const opened = state.now;
    pin(node, 101_000);
    const quick = await trade(node, "0.25", "sell");
    // 0.25 x (100,979.8 - 100,020) = 239.95 realised, all of it the fee.
    expect([quick.hold_ms, quick.profit_fee_bps, quick.realised_pnl, quick.profit_fee]).toEqual([0, 10_000, "239.95", "239.95"]);
    state.now = opened + 60_000;
    const minute = await trade(node, "0.25", "sell");
    expect([minute.hold_ms, minute.profit_fee_bps, minute.profit_fee]).toEqual([60_000, 6_421, "154.071895"]); // 239.95 x 64.21%, rounded up
    state.now = opened + 900_000;
    const base = await trade(node, "0.5", "sell");
    expect([base.hold_ms, base.profit_fee_bps, base.profit_fee]).toEqual([900_000, 1_000, "47.99"]);
    // An opening fill names no hold.
    expect("hold_ms" in (await trade(node, "1", "buy"))).toBe(false);
  });

  it("moves an add's open time to the size-weighted average, and serves each position's close fee as the node's account read does", async () => {
    const node = await funded(1_000_000);
    const { state } = node.client;
    pin(node, 100_000);
    await trade(node, "1", "buy");
    const opened = state.now;
    state.now = opened + 60_000;
    await trade(node, "1", "buy");
    // Half the size added a minute on: the open time moves half the way to now, a 30 s hold at 78.53% that falls a millisecond on.
    const view = await node.client.account(ME);
    expect(view.close_fees).toEqual({ "1": { opened_at: opened + 30_000, fee_bps: 7_853, falls_at: opened + 30_000 + 30_001 } });
  });

  it("serves its stress levels and the fee's curve in the house state, as the engine's dev genesis lists them", async () => {
    const node = await funded(1_000);
    const state = await node.client.houseState();
    expect(state.params).toMatchObject({
      profitFeeBps: 1_000,
      stressLevels: [{ size_spread_multiplier_bps: 10_000, min_spread_bps: 0 }, { size_spread_multiplier_bps: 20_000, min_spread_bps: 2 }, { size_spread_multiplier_bps: 40_000, min_spread_bps: 10 }],
      profitFeeCurve: LAUNCH_CURVE,
    });
    expect(state.listingNotices).toEqual({});
  });
});
