/** Tests for the mock's levels as the engine's V79 fires and removes them: on the closing price, through a gap, and with every full close. */

import { describe, expect, it } from "vitest";

import type { EngineEvent } from "../engine/types";
import { fixedFromInt, fixedFromWire, fixedToWire, type Fixed } from "../fixed";
import { closingPrice } from "./levels";
import type { MockNode } from "./index";
import { auth, funded, ME, order, types } from "./test-helpers";

const mid = (node: MockNode): Fixed => node.client.state.markets.get(1)?.mid ?? 0n;
const off = (node: MockNode, bps: number): string => fixedToWire(mid(node) + (mid(node) * BigInt(bps)) / 10_000n);

/** A funded node holding a 0.1 BTC-USD long with a take profit 2% above the mid and a stop loss 2% below. */
async function long() {
  const node = await funded(100_000);
  const [take, stop] = [off(node, 200), off(node, -200)];
  await order(node, "0.1", "buy", { take_profit: take, stop_loss: stop });
  const runtime = node.client.state.markets.get(1);
  if (runtime === undefined) throw new Error("BTC-USD is listed");
  const seen: EngineEvent[] = [];
  node.client.subscribe((m) => seen.push(...m.events));
  return { node, runtime, take, stop, seen };
}

/** One step of the node's clock. */
const tick = (node: MockNode) => node.client.tick(node.client.state.now + 1_000);

describe("a level that fires", () => {
  it("closes the whole position on a stop loss at the first closing price past it, gap included", async () => {
    const { node, runtime, take, stop, seen } = await long();
    runtime.mid = fixedFromWire(stop) - fixedFromInt(1_000); // the price gaps far through the stop loss
    tick(node);
    const fired = seen.filter((e) => e.type.startsWith("position_level") || e.type === "fill");
    expect(types(fired)).toEqual(["position_level_triggered", "fill", "position_levels_removed"]);
    expect(fired[0]).toMatchObject({ level: "stop_loss", price: stop });
    const fill = fired[1];
    if (fill?.type !== "fill") throw new Error("the stop loss fills");
    expect(fill.order_id).toBe(fired[0]?.type === "position_level_triggered" ? fired[0].order_id : -1);
    expect(fixedFromWire(fill.price)).toBeLessThan(fixedFromWire(stop));
    expect(fill.position).toBe("0");
    expect(fired[2]).toEqual({ type: "position_levels_removed", account: ME.toLowerCase(), market: 1, take_profit: take, stop_loss: stop, reason: "stop_loss" });
    expect(node.client.state.account(ME).levels.size).toBe(0);
  });

  it("closes the whole position on a take profit at its level or better", async () => {
    const { node, runtime, take, seen } = await long();
    runtime.mid = fixedFromWire(take) + fixedFromInt(500);
    tick(node);
    const fill = seen.find((e) => e.type === "fill");
    expect(seen.find((e) => e.type === "position_level_triggered")).toMatchObject({ level: "take_profit", price: take });
    expect(fill?.type === "fill" && fixedFromWire(fill.price) >= fixedFromWire(take)).toBe(true);
    expect(seen.find((e) => e.type === "position_levels_removed")).toMatchObject({ reason: "take_profit" });
  });

  it("fires on the closing price, not the mid: a mid a hair above the stop loss still fires it through the spread", async () => {
    const { node, runtime, stop, seen } = await long();
    // The mid sits 1 bp above the stop loss, but the bid the long closes at, after the spread, is below it.
    runtime.mid = fixedFromWire(stop) + fixedFromWire(stop) / 10_000n;
    runtime.shockBps = 0;
    expect(closingPrice(node.client.state, ME, 1, fixedFromInt(1) / 10n)).toBeLessThanOrEqual(fixedFromWire(stop));
    // The clock's own drift is a fraction of a bp a second, so the closing price stays through the stop loss.
    node.client.tick(node.client.state.now + 1);
    expect(seen.find((e) => e.type === "position_level_triggered")).toMatchObject({ level: "stop_loss" });
  });

  it("never fires while the market is closed, and fires on the first price after it reopens", async () => {
    const { node, runtime, stop, seen } = await long();
    node.controls.setHalted(1, true);
    runtime.mid = fixedFromWire(stop) - fixedFromInt(1_000);
    tick(node);
    expect(seen.some((e) => e.type === "position_level_triggered")).toBe(false);
    node.controls.setHalted(1, false);
    tick(node);
    expect(seen.find((e) => e.type === "position_level_triggered")).toMatchObject({ level: "stop_loss" });
  });
});

describe("a position's full close", () => {
  it("by Cancel all leaves the levels, which are not working orders", async () => {
    const { node } = await long();
    const result = await node.client.cancelAll({ account: ME, auth: auth(node) });
    expect(result.events).toEqual([]);
    expect(node.client.state.account(ME).levels.size).toBe(1);
  });

  it("by Close all removes them, saying Close all closed it", async () => {
    const { node, take, stop } = await long();
    const result = await node.client.closeAll({ account: ME, closes: [{ market: 1, quoted: fixedToWire(mid(node)) }], max_slippage_bps: 50, auth: auth(node) });
    expect(types(result.events)).toEqual(["order_accepted", "fill", "position_levels_removed"]);
    expect(result.events[2]).toEqual({ type: "position_levels_removed", account: ME, market: 1, take_profit: take, stop_loss: stop, reason: "close_all" });
  });

  it("by the trader's own order removes them as closed, and a reversal as reversed", async () => {
    const closed = await long();
    expect((await order(closed.node, "0.1", "sell")).events.at(-1)).toMatchObject({ type: "position_levels_removed", reason: "closed" });
    const reversed = await long();
    expect((await order(reversed.node, "0.3", "sell")).events.at(-1)).toMatchObject({ type: "position_levels_removed", reason: "reversed" });
  });

  it("by a reversal naming levels attaches them to the new position", async () => {
    const { node } = await long();
    const take = off(node, -300);
    const result = await order(node, "0.3", "sell", { take_profit: take });
    expect(types(result.events)).toEqual(["order_accepted", "fill", "position_levels_removed", "position_levels_set"]);
    expect(result.events[3]).toEqual({ type: "position_levels_set", account: ME, market: 1, take_profit: take });
  });

  it("by a close-out removes them, saying the position was closed out", async () => {
    const { node, seen } = await long();
    const account = node.client.state.account(ME);
    account.balance = fixedFromInt(1); // equity far below half the margin
    tick(node);
    expect(seen.find((e) => e.type === "position_levels_removed")).toMatchObject({ reason: "close_out" });
  });
});
