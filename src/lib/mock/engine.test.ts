/** Tests for the mock node's order, funding, close-out and access flows. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import type { EngineEvent, OrderRequest } from "../engine/types";
import { fixedFromInt, fixedToWire, parseFixed } from "../fixed";
import { createMockNode, type MockNode } from "./index";

const ME = "0xabc0000000000000000000000000000000000001";
// A Wednesday at 15:00 UTC, when every market is open.
const START = Date.UTC(2026, 9, 28, 15, 0, 0);
const SIG = `0x${"ab".repeat(65)}`;

function auth(node: MockNode) {
  const next = node.client.state.account(ME).nextNonce;
  return { nonce: next, expires_at: node.client.state.now + 60_000, signature: SIG };
}

/** A node with `ME` attested and funded with `dollars`, after finality. */
async function funded(dollars: number): Promise<MockNode> {
  const node = createMockNode(START);
  await node.client.attestEligibility({ account: ME, class: "professional", auth: auth(node) });
  node.controls.deposit(ME, fixedFromInt(dollars));
  node.client.tick(START + 1_000);
  node.client.tick(START + 7_000);
  return node;
}

async function order(node: MockNode, qty: string, side: "buy" | "sell", extra: Partial<OrderRequest> = {}, market = 1) {
  const mark = (await node.client.markets()).find((m) => m.id === market)?.mark ?? "0";
  return node.client.placeOrder({
    account: ME, client_id: 1, market, side, qty,
    kind: { type: "market", quoted: mark, max_slippage_bps: 50 }, auth: auth(node), ...extra,
  });
}

const types = (events: EngineEvent[]) => events.map((e) => e.type);

describe("access", () => {
  it("refuses the United States and sanctioned jurisdictions before anything else", async () => {
    const node = createMockNode(START);
    node.controls.setRegion("united_states");
    await expect(node.client.attestEligibility({ account: ME, class: "professional", auth: auth(node) })).rejects.toMatchObject({
      status: 403, reject: { type: "access", reason: "united_states" },
    });
    node.controls.setRegion("sanctioned_jurisdiction");
    expect(() => node.controls.deposit(ME, fixedFromInt(100))).toThrow(EngineError);
  });

  it("requires an eligibility attestation before the first deposit and before an order", async () => {
    const node = createMockNode(START);
    expect(() => node.controls.deposit(ME, fixedFromInt(100))).toThrow("eligibility attestation required");
    await expect(order(node, "0.01", "buy")).rejects.toMatchObject({ reject: { reason: "eligibility_required" } });
  });

  it("takes the first declaration only", async () => {
    const node = await funded(1_000);
    await expect(node.client.attestEligibility({ account: ME, class: "eligible_client", auth: auth(node) })).rejects.toMatchObject({ status: 409 });
  });
});

describe("signed requests", () => {
  it("consumes nonces in order and refuses an old one", async () => {
    const node = await funded(10_000);
    const stale = auth(node);
    await order(node, "0.01", "buy");
    await expect(order(node, "0.01", "buy", { auth: stale })).rejects.toMatchObject({ status: 409, reject: { type: "invalid_nonce" } });
  });

  it("refuses a missing or malformed signature and an expired request", async () => {
    const node = await funded(10_000);
    const bare = { account: ME, client_id: 1, market: 1, side: "buy" as const, qty: "0.01", kind: { type: "market" as const, quoted: "1" } };
    await expect(node.client.placeOrder(bare)).rejects.toMatchObject({ status: 401 });
    await expect(order(node, "0.01", "buy", { auth: { ...auth(node), signature: "0x12" } })).rejects.toMatchObject({ status: 401 });
    await expect(order(node, "0.01", "buy", { auth: { ...auth(node), expires_at: node.client.state.now - 1 } })).rejects.toMatchObject({ status: 400 });
  });
});

describe("deposits", () => {
  it("holds a deposit unfinalised, then credits it once", async () => {
    const node = createMockNode(START);
    await node.client.attestEligibility({ account: ME, class: "professional", auth: auth(node) });
    node.controls.deposit(ME, fixedFromInt(5_000));
    expect((await node.client.account(ME)).unfinalised_deposits).toBe("5000");
    node.client.tick(START + 7_000);
    const view = await node.client.account(ME);
    expect(view.balance).toBe("5000");
    expect(view.unfinalised_deposits).toBeUndefined();
    node.client.tick(START + 8_000);
    expect((await node.client.account(ME)).balance).toBe("5000");
  });

  it("keeps the vault's bounds", async () => {
    const node = createMockNode(START);
    await node.client.attestEligibility({ account: ME, class: "professional", auth: auth(node) });
    expect(() => node.controls.deposit(ME, fixedFromInt(9))).toThrow("10 to 1,000,000,000");
  });
});

describe("market orders", () => {
  it("fills at the live quote, moves the account's margin, and indexes the events", async () => {
    const node = await funded(100_000);
    const result = await order(node, "0.5", "buy");
    expect(types(result.events)).toEqual(["order_accepted", "fill"]);
    const view = await node.client.account(ME);
    expect(Object.keys(view.positions)).toEqual(["1"]);
    expect(parseFixed(view.margin) ?? 0n).toBeGreaterThan(0n);
    const history = await node.client.history(ME, {});
    expect(history.events[0]?.type).toBe("fill");
  });

  it("declines when the live price has moved past the slippage bound", async () => {
    const node = await funded(100_000);
    const result = await order(node, "0.01", "buy", { kind: { type: "market", quoted: "1", max_slippage_bps: 20 } });
    expect(result.events[0]).toMatchObject({ type: "order_rejected", reason: { type: "slippage" } });
  });

  it("declines a closed market, too little margin, and a house-capacity breach", async () => {
    const node = await funded(1_000);
    node.controls.setHalted(1, true);
    node.client.tick(START + 8_000);
    expect((await order(node, "0.01", "buy")).events[0]).toMatchObject({ reason: { type: "market_closed" } });
    node.controls.setHalted(1, false);
    node.client.tick(START + 9_000);
    expect((await order(node, "5", "buy")).events[0]).toMatchObject({ reason: { type: "insufficient_margin" } });
    const rich = await funded(50_000_000);
    expect((await order(rich, "20", "buy")).events[0]).toMatchObject({ reason: { type: "house_capacity" } });
  });

  it("rests a limit order until the quote reaches it, and cancels on request", async () => {
    const node = await funded(100_000);
    const resting = await order(node, "0.1", "buy", { kind: { type: "limit", price: "1000" } });
    expect(types(resting.events)).toEqual(["order_accepted"]);
    const id = (await node.client.account(ME)).orders;
    const orderId = Number(Object.keys(id)[0]);
    const cancelled = await node.client.cancelOrder({ account: ME, order_id: orderId, auth: auth(node) });
    expect(cancelled.events[0]).toMatchObject({ type: "order_cancelled", reason: "client" });
  });
});

describe("close-out", () => {
  it("liquidates every position when equity falls below the threshold, and the house absorbs a gap", async () => {
    const node = await funded(2_000);
    await order(node, "0.5", "buy");
    node.controls.shock(1, -700);
    const seen: EngineEvent[] = [];
    node.client.subscribe((m) => seen.push(...m.events));
    node.client.tick(START + 9_000);
    expect(types(seen)).toContain("close_out");
    expect(seen.find((e) => e.type === "fill")).toMatchObject({ liquidation: true });
    const view = await node.client.account(ME);
    expect(view.positions).toEqual({});
    expect(parseFixed(view.balance) ?? -1n).toBeGreaterThanOrEqual(0n);
  });
});

describe("withdrawals", () => {
  it("queues behind earlier requests and pays whole USDC base units from the head as liquidity arrives", async () => {
    const node = await funded(1_000_000);
    const result = await node.client.withdraw({ account: ME, amount: "100000.5", auth: auth(node) });
    expect(types(result.events)).toEqual(["withdrawal_queued"]);
    expect((await node.client.withdrawalQueue(ME)).queue[0]).toMatchObject({ position: 4, remaining: "100000.5" });
    node.controls.addLiquidity(fixedFromInt(40_000));
    expect((await node.client.withdrawalQueue(ME)).queue[0]?.position).toBe(3);
    node.controls.addLiquidity(fixedFromInt(185_000));
    const left = (await node.client.withdrawalQueue(ME)).queue[0];
    expect(left).toMatchObject({ position: 1, remaining: "100000.5" });
    node.controls.addLiquidity(fixedFromInt(60_000));
    expect((await node.client.withdrawalQueue(ME)).queue[0]?.remaining).toBe("40000.5");
    const rest = node.controls.addLiquidity(fixedFromInt(100_000));
    expect(rest.some((e) => e.type === "withdrawal_approved" && e.amount === "40000.5")).toBe(true);
    expect((await node.client.withdrawalQueue(ME)).queue).toEqual([]);
  });

  it("reserves whole base units only: a request finer than a millionth keeps its dust in cash (nothing is lost)", async () => {
    const node = await funded(1_000);
    await node.client.withdraw({ account: ME, amount: "100.0000009", auth: auth(node) });
    expect((await node.client.account(ME)).balance).toBe("900");
  });

  it("refuses more than the account can withdraw and an invalid amount", async () => {
    const node = await funded(1_000);
    expect((await node.client.withdraw({ account: ME, amount: "5000", auth: auth(node) })).events[0]).toMatchObject({ type: "withdrawal_rejected", reason: { type: "insufficient_funds" } });
    expect((await node.client.withdraw({ account: ME, amount: "-1", auth: auth(node) })).events[0]).toMatchObject({ reason: { type: "invalid_amount" } });
  });
});

describe("market hours and stress", () => {
  it("closes a market outside its session and opens it again", () => {
    const node = createMockNode(START);
    const seen: EngineEvent[] = [];
    node.client.subscribe((m) => seen.push(...m.events));
    node.client.tick(Date.UTC(2026, 9, 28, 21, 30, 0));
    expect(seen).toContainEqual({ type: "market_closed", market: 4 });
    node.client.tick(Date.UTC(2026, 9, 29, 14, 31, 0));
    expect(seen).toContainEqual({ type: "market_opened", market: 4 });
  });

  it("reports an operator stress floor", async () => {
    const node = createMockNode(START);
    node.controls.setStressFloor(null, 2);
    node.client.tick(START + 1_000);
    expect((await node.client.markets()).every((m) => m.stress_level === 2)).toBe(true);
  });
});

describe("engine rules the mock follows", () => {
  it("fills a resting limit that is already executable when it is accepted", async () => {
    const node = await funded(100_000);
    const result = await order(node, "0.1", "buy", { kind: { type: "limit", price: "1000000" } });
    expect(types(result.events)).toEqual(["order_accepted", "fill"]);
    expect(Object.keys((await node.client.account(ME)).orders)).toEqual([]);
  });

  it("triggers a stop on the index, not on a spread that stress has widened", async () => {
    const node = await funded(100_000);
    const mark = parseFixed((await node.client.markets())[0]?.mark ?? "0") ?? 0n;
    const level = fixedToWire(mark + mark / 1_000n); // 0.1% above the index: inside the stress-3 spread but above the index
    await order(node, "0.1", "buy", { kind: { type: "stop", price: level } });
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
    const node = await funded(2_000);
    await order(node, "0.5", "buy");
    await order(node, "10", "sell", {}, 3);
    node.controls.shock(1, -3_000);
    const seen: EngineEvent[] = [];
    node.client.subscribe((m) => seen.push(...m.events));
    node.client.tick(START + 9_000);
    expect(types(seen)).toContain("close_out");
    const view = await node.client.account(ME);
    expect(parseFixed(view.balance) ?? -1n).toBeGreaterThanOrEqual(0n);
  });

  it("treats a flip to the other side as added risk, so a reduce-only order cannot flip", async () => {
    const node = await funded(100_000);
    await order(node, "0.5", "buy");
    const flip = await order(node, "1.5", "sell", { reduce_only: true });
    expect(flip.events[0]).toMatchObject({ type: "order_rejected", reason: { type: "reduce_only" } });
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
