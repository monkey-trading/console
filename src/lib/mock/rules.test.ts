/** Tests for the engine rules the mock follows, and its history. */

import { describe, expect, it } from "vitest";

import type { EngineEvent } from "../engine/types";
import { fixedFromInt, fixedToWire, parseFixed } from "../fixed";
import { fillEvents, fillOrder } from "./execute";
import { funded, ME, order, START, types } from "./test-helpers";

describe("close-out of several positions", () => {
  it("closes the largest tradable loser first, stops once healthy, skips a halted market, and announces once", async () => {
    const node = await funded(3_000);
    const { state } = node.client;
    const account = state.account(ME);
    const mid = (id: number) => state.markets.get(id)?.mid ?? 0n;
    // BTC loses the most, ETH loses a little; EUR (halted) loses too but cannot trade.
    account.positions.set(1, { qty: fixedFromInt(1), entry: mid(1) + fixedFromInt(2_000) });
    account.positions.set(2, { qty: fixedFromInt(1), entry: mid(2) + fixedFromInt(50) });
    account.positions.set(3, { qty: fixedFromInt(1_000), entry: mid(3) + fixedFromInt(1) });
    node.controls.setHalted(3, true);
    const seen: EngineEvent[] = [];
    node.client.subscribe((m) => seen.push(...m.events));
    node.client.tick(START + 9_000);
    const fills = seen.filter((e) => e.type === "fill");
    expect(fills[0]).toMatchObject({ market: 1, liquidation: true });
    expect(types(seen).filter((t) => t === "close_out")).toHaveLength(1);
    expect(account.positions.has(3)).toBe(true); // a halted market's position waits
    node.client.tick(START + 10_000);
    expect(types(seen).filter((t) => t === "close_out")).toHaveLength(1); // not repeated while nothing can trade
  });
});

describe("engine rules the mock follows", () => {
  it("fills a resting limit that is already executable when it is accepted", async () => {
    const node = await funded(100_000);
    const result = await order(node, "0.1", "buy", { kind: { kind: "limit", price: "1000000" } });
    expect(types(result.events)).toEqual(["order_accepted", "fill"]);
    expect(Object.keys((await node.client.account(ME)).orders)).toEqual([]);
  });

  it("triggers a stop on the index, not on a spread that stress has widened", async () => {
    const node = await funded(100_000);
    const mark = parseFixed((await node.client.markets())[0]?.mark ?? "0") ?? 0n;
    const level = fixedToWire(mark + mark / 1_000n); // 0.1% above the index: inside the stress-3 spread but above the index
    await order(node, "0.1", "buy", { kind: { kind: "stop", price: level } });
    node.controls.setStressFloor(1, 3);
    node.client.tick(START + 9_000);
    expect(Object.keys((await node.client.account(ME)).orders)).toHaveLength(1);
  });

  it("charges financing as a positive amount the account pays", async () => {
    const node = await funded(100_000);
    await order(node, "0.5", "buy");
    const seen: EngineEvent[] = [];
    node.client.subscribe((m) => seen.push(...m.events));
    node.client.tick(Date.UTC(2026, 9, 28, 22, 5, 0));
    const charge = seen.find((e) => e.type === "financing");
    expect(charge).toMatchObject({ type: "financing" });
    expect(parseFixed(charge?.type === "financing" ? charge.amount : "0") ?? 0n).toBeGreaterThan(0n);
  });

  it("writes a loss beyond the balance off against the house only once the account is flat", async () => {
    const node = await funded(1_000);
    const { state } = node.client;
    const account = state.account(ME);
    // A large loser in BTC and a flat position in ETH; the balance cannot cover the loss.
    account.balance = fixedFromInt(10);
    account.positions.set(1, { qty: fixedFromInt(1), entry: fixedFromInt(70_000) });
    account.positions.set(2, { qty: fixedFromInt(1), entry: state.markets.get(2)?.mid ?? 0n });
    const houseBefore = state.houseCash;
    const first = fillOrder(state, { address: ME, market: 1, side: "sell", qty: fixedFromInt(1), reduceOnly: true, orderId: 0, liquidation: true });
    expect(first).toMatchObject({ ok: true, badDebt: 0n });
    expect(account.balance).toBeLessThan(0n); // the debt stays while ETH is still open
    expect(state.houseCash).toBeGreaterThan(houseBefore); // the house holds the loss's counterpart, not a write-off
    const second = fillOrder(state, { address: ME, market: 2, side: "sell", qty: fixedFromInt(1), reduceOnly: true, orderId: 0, liquidation: true });
    if (!second.ok) throw new Error("the second close fills");
    expect(second.badDebt).toBeGreaterThan(0n);
    expect(account.balance).toBe(0n);
    expect(types(fillEvents(second.fill, second.badDebt))).toEqual(["fill", "bad_debt"]);
  });

  it("treats a flip to the other side as added risk, so a reduce-only order cannot flip", async () => {
    const node = await funded(100_000);
    await order(node, "0.5", "buy");
    const flip = await order(node, "1.5", "sell", { reduce_only: true });
    expect(flip.events[0]).toMatchObject({ type: "order_rejected", reason: { kind: "reduce_only" } });
  });
});

describe("history", () => {
  it("pages by per-event cursors without losing events inside one command", async () => {
    const node = await funded(100_000);
    const result = await order(node, "0.5", "buy");
    expect(types(result.events)).toEqual(["order_accepted", "fill"]);
    const first = await node.client.history(ME, { limit: 1 });
    expect(first.events[0]?.type).toBe("fill");
    expect(first.events[0]?.cursor).toMatch(/^\d+:1$/);
    const second = await node.client.history(ME, { limit: 1, before: first.next ?? undefined });
    expect(second.events[0]?.type).toBe("order_accepted");
    expect(second.events[0]?.cursor).toMatch(/^\d+:0$/);
  });
});
