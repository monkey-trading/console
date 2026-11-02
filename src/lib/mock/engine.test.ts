/** Tests for the mock node's order, funding, close-out and access flows. */

import { describe, expect, it } from "vitest";

import type { EngineEvent } from "../engine/types";
import { fixedFromInt, fixedToWire, parseFixed } from "../fixed";
import { createMockNode } from "./index";
import { auth, funded, ME, order, START, types } from "./test-helpers";

describe("access", () => {
  it("refuses the United States and sanctioned jurisdictions on every screened action, before auth and eligibility", async () => {
    const node = createMockNode(START);
    const bad = { nonce: 99, expires_at: 0, signature: "0x" };
    node.controls.setRegion("united_states");
    await expect(node.client.attestEligibility({ account: ME, class: "professional", auth: bad })).rejects.toMatchObject({
      status: 403, reject: { kind: "access", reason: "united_states" },
    });
    node.controls.setRegion("sanctioned_jurisdiction");
    for (const attempt of [
      node.client.attestEligibility({ account: ME, class: "professional", auth: bad }),
      node.client.placeOrder({ account: ME, client_id: 1, market: 1, side: "buy", qty: "1", kind: { kind: "market", quoted: "1" }, auth: bad }),
      node.client.withdraw({ account: ME, amount: "10", auth: bad }),
    ]) {
      await expect(attempt).rejects.toMatchObject({ status: 403, reject: { kind: "access", reason: "sanctioned_jurisdiction" } });
    }
    await expect(node.client.accessProbe()).rejects.toMatchObject({ status: 403 });
    // A vault deposit is screened on the paying address, not the connection, so the region does not refuse it.
    expect(() => node.controls.deposit(ME, fixedFromInt(100))).toThrow("eligibility attestation required");
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
    await expect(order(node, "0.01", "buy", { auth: stale })).rejects.toMatchObject({ status: 409, reject: { kind: "invalid_nonce" } });
  });

  it("refuses a missing or malformed signature and an expired request", async () => {
    const node = await funded(10_000);
    const bare = { account: ME, client_id: 1, market: 1, side: "buy" as const, qty: "0.01", kind: { kind: "market" as const, quoted: "1" } };
    await expect(node.client.placeOrder(bare)).rejects.toMatchObject({ status: 401 });
    await expect(order(node, "0.01", "buy", { auth: { ...auth(node), signature: "0x12" } })).rejects.toMatchObject({ status: 401 });
    await expect(order(node, "0.01", "buy", { auth: { ...auth(node), expires_at: node.client.state.now - 1 } })).rejects.toMatchObject({ status: 400 });
  });
});

describe("deposits", () => {
  it("counts a deposit as collateral at once, locked from withdrawal until it is final", async () => {
    const node = createMockNode(START);
    await node.client.attestEligibility({ account: ME, class: "professional", auth: auth(node) });
    node.controls.deposit(ME, fixedFromInt(5_000));
    const early = await node.client.account(ME);
    expect(early.balance).toBe("5000");
    expect(early.unfinalised_deposits).toBe("5000");
    const locked = await node.client.withdraw({ account: ME, amount: "100", auth: auth(node) });
    expect(locked.events[0]).toMatchObject({ type: "withdrawal_rejected", reason: { kind: "insufficient_funds", available: "0" } });
    node.client.tick(START + 7_000);
    const view = await node.client.account(ME);
    expect(view.balance).toBe("5000");
    expect(view.unfinalised_deposits).toBeUndefined();
    expect((await node.client.withdraw({ account: ME, amount: "100", auth: auth(node) })).events[0]?.type).not.toBe("withdrawal_rejected");
  });

  it("keeps the vault's bounds", async () => {
    const node = createMockNode(START);
    await node.client.attestEligibility({ account: ME, class: "professional", auth: auth(node) });
    expect(() => node.controls.deposit(ME, fixedFromInt(9))).toThrow("10 to 1,000,000,000");
    expect(() => node.controls.deposit(ME, parseFixed("10.0000001") ?? 0n)).toThrow("six decimal places");
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
    const result = await order(node, "0.01", "buy", { kind: { kind: "market", quoted: "1", max_slippage_bps: 20 } });
    expect(result.events[0]).toMatchObject({ type: "order_rejected", reason: { kind: "slippage" } });
  });

  it("declines a closed market, too little margin, and a house-capacity breach", async () => {
    const node = await funded(1_000);
    node.controls.setHalted(1, true);
    node.client.tick(START + 8_000);
    expect((await order(node, "0.01", "buy")).events[0]).toMatchObject({ reason: { kind: "market_closed" } });
    node.controls.setHalted(1, false);
    node.client.tick(START + 9_000);
    expect((await order(node, "5", "buy")).events[0]).toMatchObject({ reason: { kind: "insufficient_margin" } });
    const rich = await funded(50_000_000);
    expect((await order(rich, "20", "buy")).events[0]).toMatchObject({ reason: { kind: "house_capacity" } });
  });

  it("rests a limit order until the quote reaches it, then fills it; an unreached one cancels on request", async () => {
    const node = await funded(100_000);
    const mark = parseFixed((await node.client.markets())[0]?.mark ?? "0") ?? 0n;
    const near = fixedToWire(mark - mark / 100n); // 1% below the index
    const resting = await order(node, "0.1", "buy", { kind: { kind: "limit", price: near } });
    expect(types(resting.events)).toEqual(["order_accepted"]);
    const seen: EngineEvent[] = [];
    node.client.subscribe((m) => seen.push(...m.events));
    node.client.tick(START + 8_000);
    expect(types(seen)).not.toContain("fill");
    node.controls.shock(1, -300);
    node.client.tick(START + 9_000);
    expect(seen.find((e) => e.type === "fill")).toMatchObject({ type: "fill", side: "buy" });
    expect(Object.keys((await node.client.account(ME)).orders)).toEqual([]);
    const far = await order(node, "0.1", "buy", { kind: { kind: "limit", price: "1000" } });
    expect(types(far.events)).toEqual(["order_accepted"]);
    const orderId = Number(Object.keys((await node.client.account(ME)).orders)[0]);
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

  it("lists no unpaid approval after approving one, as the mock pays at once, from a loaded answer at its head", async () => {
    const node = await funded(1_000);
    await node.client.withdraw({ account: ME, amount: "100", auth: auth(node) });
    expect(types(node.controls.addLiquidity(fixedFromInt(1_000_000)))).toContain("withdrawal_approved");
    await expect(node.client.payouts()).resolves.toEqual({ seq: node.client.headSeq, loaded: true, payouts: [], next: null });
    expect(node.client.headSeq).not.toBeNull();
  });

  it("reserves whole base units only: a request finer than a millionth keeps its dust in cash (nothing is lost)", async () => {
    const node = await funded(1_000);
    await node.client.withdraw({ account: ME, amount: "100.0000009", auth: auth(node) });
    expect((await node.client.account(ME)).balance).toBe("900");
  });

  it("refuses more than the account can withdraw and an invalid amount", async () => {
    const node = await funded(1_000);
    expect((await node.client.withdraw({ account: ME, amount: "5000", auth: auth(node) })).events[0]).toMatchObject({ type: "withdrawal_rejected", reason: { kind: "insufficient_funds" } });
    expect((await node.client.withdraw({ account: ME, amount: "-1", auth: auth(node) })).events[0]).toMatchObject({ reason: { kind: "invalid_amount" } });
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
