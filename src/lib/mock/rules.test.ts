/** Tests for the engine rules the mock follows, and its history. */

import { describe, expect, it } from "vitest";

import type { EngineEvent } from "../engine/types";
import { fixedFromInt, fixedToWire, parseFixed } from "../fixed";
import { fillEvents, fillOrder } from "./execute";
import { createMockNode } from "./index";
import { auth, funded, ME, order, START, types } from "./test-helpers";

describe("close-out of several positions", () => {
  async function setup(btcLoss: number) {
    const node = await funded(3_000);
    const { state } = node.client;
    const account = state.account(ME);
    const mid = (id: number) => state.markets.get(id)?.mid ?? 0n;
    account.positions.set(1, { qty: fixedFromInt(1), entry: mid(1) + fixedFromInt(btcLoss) });
    account.positions.set(2, { qty: fixedFromInt(1), entry: mid(2) + fixedFromInt(50) });
    account.positions.set(3, { qty: fixedFromInt(1_000), entry: mid(3) + fixedFromInt(1) });
    return { node, account };
  }

  it("closes the largest tradable loser first, skips a halted market, and announces once", async () => {
    const { node, account } = await setup(2_000);
    node.controls.setHalted(3, true);
    const seen: EngineEvent[] = [];
    node.client.subscribe((m) => seen.push(...m.events));
    node.client.tick(START + 9_000);
    expect(seen.filter((e) => e.type === "fill")[0]).toMatchObject({ market: 1, liquidation: true });
    expect(types(seen).filter((t) => t === "close_out")).toHaveLength(1);
    expect(account.positions.has(3)).toBe(true); // a halted market's position waits
    node.client.tick(START + 10_000);
    expect(types(seen).filter((t) => t === "close_out")).toHaveLength(1); // not repeated while nothing can trade
  });

  it("stops as soon as the account is healthy again, leaving the other positions open", async () => {
    // BTC's 1,500 loss puts equity under half the margin; with BTC closed, equity covers what is left.
    const { node, account } = await setup(1_500);
    const seen: EngineEvent[] = [];
    node.client.subscribe((m) => seen.push(...m.events));
    node.client.tick(START + 9_000);
    const closed = seen.filter((e) => e.type === "fill").map((e) => (e.type === "fill" ? e.market : 0));
    expect(closed).toEqual([1]);
    expect([...account.positions.keys()].sort()).toEqual([2, 3]);
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
    const houseAfterFirst = state.houseCash;
    const second = fillOrder(state, { address: ME, market: 2, side: "sell", qty: fixedFromInt(1), reduceOnly: true, orderId: 0, liquidation: true });
    if (!second.ok) throw new Error("the second close fills");
    expect(second.badDebt).toBeGreaterThan(0n);
    expect(account.balance).toBe(0n);
    // The write-off comes out of the house's cash: it ends below what it held before the debt.
    expect(state.houseCash).toBeLessThan(houseAfterFirst);
    expect(types(fillEvents(second.fill, second.badDebt))).toEqual(["fill", "bad_debt"]);
  });

  it("treats a flip as added risk, but clamps an oversized reduce-only order to what it can reduce", async () => {
    const node = await funded(100_000);
    await order(node, "0.5", "buy");
    const held = (await node.client.account(ME)).positions["1"]?.qty ?? "0";
    const clamped = await order(node, "1.5", "sell", { reduce_only: true });
    expect(clamped.events[1]).toMatchObject({ type: "fill", qty: held, position: "0" });
    const same = await order(node, "0.1", "buy", { reduce_only: true });
    expect(same.events[0]).toMatchObject({ type: "order_rejected", reason: { kind: "reduce_only" } });
    const flip = await order(node, "0.5", "buy");
    expect(types(flip.events)).toEqual(["order_accepted", "fill"]);
    const reverse = await order(node, "1.2", "sell");
    expect(reverse.events[1]).toMatchObject({ type: "fill", side: "sell" });
    expect(parseFixed((reverse.events[1] as { position: string }).position) ?? 0n).toBeLessThan(0n);
  });
});

describe("resting orders that cannot fill", () => {
  it("is cancelled as unfillable when it triggers but the account cannot carry it", async () => {
    const node = await funded(1_000);
    // Admitted without a margin check, already executable, so it triggers at once and fails the check.
    const result = await order(node, "5", "buy", { kind: { kind: "limit", price: "1000000" } });
    expect(types(result.events)).toEqual(["order_accepted", "order_cancelled"]);
    expect(result.events[1]).toMatchObject({ reason: "unfillable" });
  });
});

describe("resting-order limits and cancels", () => {
  it("refuses an eleventh resting order, and lets a blocked region cancel what it already has", async () => {
    const node = await funded(100_000);
    for (let i = 0; i < 10; i++) await order(node, "0.01", "buy", { kind: { kind: "limit", price: "50000" } });
    const eleventh = await order(node, "0.01", "buy", { kind: { kind: "limit", price: "50000" } });
    expect(eleventh.events[0]).toMatchObject({ type: "order_rejected", reason: { kind: "invalid_order", reason: "at most 10 resting orders" } });
    node.controls.setRegion("united_states");
    const id = Number(Object.keys((await node.client.account(ME)).orders)[0]);
    const cancelled = await node.client.cancelOrder({ account: ME, order_id: id, auth: auth(node) });
    expect(cancelled.events[0]).toMatchObject({ type: "order_cancelled", reason: "client" });
  });
});

describe("finalized deposits", () => {
  it("add to the vault's liquidity, which pays the queue from its head", async () => {
    const node = createMockNode(START);
    await node.client.attestEligibility({ account: ME, class: "professional", auth: auth(node) });
    node.controls.deposit(ME, fixedFromInt(100_000));
    const seen: EngineEvent[] = [];
    node.client.subscribe((m) => seen.push(...m.events));
    node.client.tick(START + 7_000);
    const approved = seen.filter((e) => e.type === "withdrawal_approved");
    expect(approved[0]).toMatchObject({ account: "0x1111111111111111111111111111111111111111", amount: "40000" });
    // An account's approval nonces count up from one and are never reused: its second approval gets the next one.
    const second = node.controls.addLiquidity(fixedFromInt(100_000));
    const forSecond = (events: EngineEvent[]) => events.flatMap((e) => (e.type === "withdrawal_approved" && e.account.startsWith("0x2222") ? [e.nonce] : []));
    expect(forSecond(approved)).toEqual([1]);
    expect(forSecond(second)).toEqual([2]);
  });
});

describe("minimums and the vault", () => {
  it("refuses an order under the minimum notional, at its market price and at a resting order's trigger price", async () => {
    const node = await funded(100_000);
    const market = await order(node, "0.001", "buy"); // about $67
    expect(market.events[0]).toMatchObject({ type: "order_rejected", reason: { kind: "invalid_order" } });
    const resting = await order(node, "0.1", "buy", { kind: { kind: "limit", price: "500" } }); // $50 at its own price
    expect(resting.events[0]).toMatchObject({ type: "order_rejected", reason: { kind: "invalid_order" } });
    const fine = await order(node, "0.01", "buy");
    expect(types(fine.events)).toEqual(["order_accepted", "fill"]);
  });

  it("approves what the vault holds at request time, queues the rest, and defers a part under 10 USDC", async () => {
    const node = await funded(100_000);
    const { state } = node.client;
    state.queue.splice(0);
    state.vaultLiquidity = fixedFromInt(300);
    const split = await node.client.withdraw({ account: ME, amount: "1000", auth: auth(node) });
    expect(types(split.events)).toEqual(["withdrawal_approved", "withdrawal_queued"]);
    expect(split.events[0]).toMatchObject({ amount: "300", nonce: 1 });
    expect(split.events[1]).toMatchObject({ amount: "700" });
    state.vaultLiquidity = fixedFromInt(5);
    const deferred = node.controls.addLiquidity(0n);
    expect(types(deferred)).toEqual([]); // 5 USDC is under the minimum part and does not settle the request
    const small = await node.client.withdraw({ account: ME, amount: "9", auth: auth(node) });
    expect(small.events[0]).toMatchObject({ type: "withdrawal_rejected", reason: { kind: "invalid_amount" } });
  });

  it("evaluates only the newly inserted resting order, not older ones", async () => {
    const node = await funded(100_000);
    const mark = parseFixed((await node.client.markets())[0]?.mark ?? "0") ?? 0n;
    const older = await order(node, "0.1", "buy", { kind: { kind: "limit", price: fixedToWire(mark - mark / 100n) } });
    expect(types(older.events)).toEqual(["order_accepted"]);
    // Make the older BTC order executable without a tick, by moving the index down directly.
    const btc = node.client.state.markets.get(1);
    if (!btc) throw new Error("BTC-USD is listed");
    btc.mid -= btc.mid / 50n;
    const other = await order(node, "1", "buy", { kind: { kind: "limit", price: "1000" } }, 2);
    expect(types(other.events)).toEqual(["order_accepted"]); // the older BTC order did not fire as a side effect
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
