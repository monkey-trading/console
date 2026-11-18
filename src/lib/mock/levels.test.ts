/** Tests for the mock's take-profit and stop-loss levels as the engine's V79 sets them: on an order, by a request, and their checks. */

import { describe, expect, it } from "vitest";

import type { EngineEvent, OrderRequest } from "../engine/types";
import { fixedFromWire, fixedToWire, type Fixed } from "../fixed";
import { closingPrice } from "./levels";
import type { MockNode } from "./index";
import { auth, funded, ME, order, types } from "./test-helpers";

/** BTC-USD's mid now. */
const mid = (node: MockNode, market = 1): Fixed => node.client.state.markets.get(market)?.mid ?? 0n;
/** `bps` of the mid away from it, as a wire decimal. */
const off = (node: MockNode, bps: number, market = 1): string => fixedToWire(mid(node, market) + (mid(node, market) * BigInt(bps)) / 10_000n);

/** A market order naming `levels`. */
const withLevels = (node: MockNode, qty: string, side: "buy" | "sell", levels: Pick<OrderRequest, "take_profit" | "stop_loss" | "reduce_only">, market = 1) => order(node, qty, side, levels, market);

/** The levels request, signed by `ME`. */
const setLevels = (node: MockNode, levels: { take_profit?: string; stop_loss?: string }, market = 1) => node.client.setPositionLevels({ account: ME, market, ...levels, auth: auth(node) });

const rejection = (events: EngineEvent[]) => events.find((e) => e.type === "order_rejected");

describe("an order naming levels", () => {
  it("attaches them to the position it opens, and the account read lists them", async () => {
    const node = await funded(100_000);
    const [take, stop] = [off(node, 200), off(node, -200)];
    const result = await withLevels(node, "0.1", "buy", { take_profit: take, stop_loss: stop });
    expect(types(result.events)).toEqual(["order_accepted", "fill", "position_levels_set"]);
    expect(result.events[2]).toEqual({ type: "position_levels_set", account: ME, market: 1, take_profit: take, stop_loss: stop });
    expect((await node.client.account(ME)).levels).toEqual({ 1: { take_profit: take, stop_loss: stop } });
  });

  it("is refused, before anything is booked, for a level within the minimum distance of the closing price", async () => {
    const node = await funded(100_000);
    // 30 bps is BTC-USD's distance; 10 bps above the mid is closer than that beyond the bid the long would close at.
    const result = await withLevels(node, "0.1", "buy", { take_profit: off(node, 10) });
    const reason = rejection(result.events);
    expect(reason).toMatchObject({ type: "order_rejected", reason: { kind: "level_too_close", level: off(node, 10), min_distance_bps: 30 } });
    expect(reason?.type === "order_rejected" && reason.reason.kind === "level_too_close" ? fixedFromWire(reason.reason.reference) : null).toBe(closingPrice(node.client.state, ME, 1, 100_000_000n));
    expect((await node.client.account(ME)).positions).toEqual({});
  });

  it("is refused for a stop loss on the wrong side of the closing price", async () => {
    const node = await funded(100_000);
    const result = await withLevels(node, "0.1", "buy", { stop_loss: off(node, 100) });
    expect(rejection(result.events)).toMatchObject({ reason: { kind: "level_too_close", level: off(node, 100) } });
  });

  it("is refused when it is reduce-only, as it opens nothing for the levels to protect", async () => {
    const node = await funded(100_000);
    await order(node, "0.2", "buy");
    const result = await withLevels(node, "0.1", "sell", { take_profit: off(node, -200), reduce_only: true });
    expect(rejection(result.events)).toMatchObject({ reason: { kind: "invalid_order", reason: "a reduce-only order names no levels" } });
  });

  it("drops the levels of an order that leaves no position on its side, saying so", async () => {
    const node = await funded(100_000);
    await order(node, "0.2", "buy");
    const result = await withLevels(node, "0.1", "sell", { take_profit: off(node, -200) });
    expect(types(result.events)).toEqual(["order_accepted", "fill", "position_levels_removed"]);
    expect(result.events[2]).toMatchObject({ take_profit: off(node, -200), reason: "not_opened" });
    expect((await node.client.account(ME)).levels).toBeUndefined();
  });

  it("on an add keeps the level it leaves out and measures only the one it moves", async () => {
    const node = await funded(100_000);
    const take = off(node, 200);
    await withLevels(node, "0.1", "buy", { take_profit: take, stop_loss: off(node, -200) });
    const stop = off(node, -300);
    const result = await withLevels(node, "0.1", "buy", { stop_loss: stop });
    expect(result.events.at(-1)).toEqual({ type: "position_levels_set", account: ME, market: 1, take_profit: take, stop_loss: stop });
  });

  it("on a working order waits with it, measured from its own price, and attaches when it fills", async () => {
    const node = await funded(100_000);
    const trigger = mid(node) - mid(node) / 100n;
    const at = (bps: number) => fixedToWire(trigger + (trigger * BigInt(bps)) / 10_000n);
    const tooClose = await order(node, "0.1", "buy", { kind: { kind: "limit", price: fixedToWire(trigger) }, stop_loss: at(-10) });
    expect(rejection(tooClose.events)).toMatchObject({ reason: { kind: "level_too_close", reference: fixedToWire(trigger) } });
    const rested = await order(node, "0.1", "buy", { kind: { kind: "limit", price: fixedToWire(trigger) }, take_profit: at(300), stop_loss: at(-300) });
    expect(types(rested.events)).toEqual(["order_accepted"]);
    expect(Object.values((await node.client.account(ME)).orders)[0]).toMatchObject({ take_profit: at(300), stop_loss: at(-300) });
    const runtime = node.client.state.markets.get(1);
    if (runtime === undefined) throw new Error("BTC-USD is listed");
    runtime.mid = trigger - trigger / 100n; // 1% under the trigger, past any spread the move adds
    const seen: EngineEvent[] = [];
    node.client.subscribe((m) => seen.push(...m.events));
    node.client.tick(node.client.state.now + 1_000);
    expect(types(seen)).toEqual(expect.arrayContaining(["fill", "position_levels_set"]));
    expect((await node.client.account(ME)).levels).toEqual({ 1: { take_profit: at(300), stop_loss: at(-300) } });
  });
});

describe("the levels request", () => {
  it("sets, moves and removes a position's levels, each change one event", async () => {
    const node = await funded(100_000);
    await order(node, "0.1", "buy");
    const [take, stop] = [off(node, 200), off(node, -200)];
    expect((await setLevels(node, { take_profit: take, stop_loss: stop })).events).toEqual([{ type: "position_levels_set", account: ME, market: 1, take_profit: take, stop_loss: stop }]);
    // A level the request leaves out is removed.
    expect((await setLevels(node, { stop_loss: off(node, -300) })).events).toEqual([{ type: "position_levels_set", account: ME, market: 1, stop_loss: off(node, -300) }]);
    expect((await setLevels(node, {})).events).toEqual([{ type: "position_levels_set", account: ME, market: 1 }]);
    expect((await node.client.account(ME)).levels).toBeUndefined();
  });

  it("measures only a level it moves: one held unchanged passes though the price has come within the distance", async () => {
    const node = await funded(100_000);
    await order(node, "0.1", "buy");
    const take = off(node, 200);
    await setLevels(node, { take_profit: take });
    const runtime = node.client.state.markets.get(1);
    if (runtime === undefined) throw new Error("BTC-USD is listed");
    runtime.mid = fixedFromWire(take) - fixedFromWire(take) / 1_000n; // 10 bps under the take profit
    expect(types((await setLevels(node, { take_profit: take, stop_loss: off(node, -200) })).events)).toEqual(["position_levels_set"]);
    expect(rejection((await setLevels(node, { take_profit: off(node, 10) })).events)).toMatchObject({ client_id: 0, reason: { kind: "level_too_close" } });
  });

  it("is refused with no position, a level out of range, or an unknown market", async () => {
    const node = await funded(100_000);
    expect(rejection((await setLevels(node, { take_profit: off(node, 200) })).events)).toMatchObject({ client_id: 0, reason: { kind: "invalid_order", reason: "no position to set levels on" } });
    await order(node, "0.1", "buy");
    expect(rejection((await setLevels(node, { take_profit: "0" })).events)).toMatchObject({ reason: { kind: "invalid_order", reason: "level out of range" } });
    expect(rejection((await setLevels(node, { take_profit: "1" }, 99)).events)).toMatchObject({ reason: { kind: "unknown_market" } });
  });
});

describe("working order slots", () => {
  it("count a market's take profit and stop loss as one, refusing a first pair or an order past the tier's limit", async () => {
    const node = await funded(100_000);
    await withLevels(node, "0.1", "buy", { take_profit: off(node, 200), stop_loss: off(node, -200) });
    // Tier 0 allows 25 working orders: the BTC-USD pair is one, so 24 limits fill the rest.
    for (let i = 0; i < 24; i += 1) expect(types((await order(node, "0.1", "buy", { kind: { kind: "limit", price: "1000" } })).events)).toEqual(["order_accepted"]);
    expect(rejection((await withLevels(node, "1", "buy", { stop_loss: off(node, -200, 2) }, 2)).events)).toMatchObject({ reason: { kind: "tier_order_limit", tier: 0, max: 25 } });
    expect(rejection((await order(node, "0.1", "buy", { kind: { kind: "limit", price: "1000" } })).events)).toMatchObject({ reason: { kind: "tier_order_limit", tier: 0, max: 25 } });
    // Moving the levels a position already holds needs no new slot.
    expect(types((await setLevels(node, { take_profit: off(node, 300) })).events)).toEqual(["position_levels_set"]);
  });
});
