/** Tests for the store driving the mock node through the user's whole path. */

import { describe, expect, it, vi } from "vitest";

import { fixedFromInt, parseFixed } from "../fixed";
import { createMockNode, SIM_EPOCH_MS } from "../mock";
import { resetVault } from "../mock/test-helpers";
import { mockHistory } from "../mock/history";
import { attestEligibility, cancelOrder, connectWallet, deposit, placeOrder, withdraw } from "./actions";
import { ConsoleStore } from "./store";

// A Wednesday afternoon, when every market is open.
const START = Date.UTC(2026, 9, 28, 15, 0, 0);

function setup() {
  const node = createMockNode(SIM_EPOCH_MS);
  const store = new ConsoleStore({
    client: node.client, wallets: node.wallets, drive: (ms) => node.client.tick(ms), history: mockHistory,
    initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS },
  });
  store.start(START);
  return { node, store };
}

async function funded() {
  const ctx = setup();
  await ctx.store.checkNode();
  await connectWallet(ctx.store, "browser");
  await attestEligibility(ctx.store, "professional");
  await deposit(ctx.store, fixedFromInt(50_000));
  ctx.store.tick(START + 1_000);
  ctx.store.tick(START + 8_000);
  resetVault(ctx.node);
  await ctx.store.refresh(true);
  return ctx;
}

const buy = (store: ConsoleStore, notional: number, kind: Parameters<typeof placeOrder>[1]["kind"] = { kind: "market" }) =>
  placeOrder(store, { market: 1, side: "buy", notional: fixedFromInt(notional), slippageBps: 10, kind, reduceOnly: false });

describe("the user's path", () => {
  it("accepts the mock attestation, then connects, attests, deposits, and trades", async () => {
    const { store } = await funded();
    const state = store.getSnapshot();
    expect(state.attestation.kind).toBe("mock");
    expect(state.eligibility).toBe("professional");
    expect(state.account?.balance).toBe(fixedFromInt(50_000));
    await buy(store, 20_000);
    expect(store.getSnapshot().account?.positions).toHaveLength(1);
    expect(store.getSnapshot().toasts.at(-1)?.text).toContain("Filled");
    expect(store.getSnapshot().history[0]?.type).toBe("fill");
  });

  it("refuses to sign for a node whose attestation it cannot verify", async () => {
    const { node, store } = setup();
    node.controls.setAttestationMode("unverifiable");
    await store.checkNode();
    await connectWallet(store, "browser");
    await attestEligibility(store, "professional");
    expect(store.getSnapshot().attestation.kind).toBe("unverified");
    expect(store.getSnapshot().eligibility).toBeNull();
    expect(store.getSnapshot().toasts.at(-1)?.text).toContain("will not sign");
  });

  it("shows the geo-block when the node refuses the region, and clears it when the region changes", async () => {
    const { node, store } = setup();
    node.controls.setRegion("united_states");
    await store.checkNode();
    expect(store.getSnapshot().blocked).toBe("united_states");
    node.controls.setRegion("allowed");
    await store.checkNode();
    expect(store.getSnapshot().blocked).toBeNull();
  });

  it("explains a refused order and cancels a resting one", async () => {
    const { store } = await funded();
    await buy(store, 5_000_000);
    expect(store.getSnapshot().toasts.at(-1)?.text).toMatch(/equity|house|too|Not enough/i);
    await buy(store, 10_000, { kind: "limit", price: parseFixed("1000") ?? 0n });
    const order = store.getSnapshot().account?.orders[0];
    expect(order).toBeDefined();
    await cancelOrder(store, order?.order_id ?? 0);
    expect(store.getSnapshot().account?.orders).toHaveLength(0);
  });

  it("queues a withdrawal behind earlier ones and shows its position", async () => {
    const { store } = await funded();
    await withdraw(store, fixedFromInt(10_000));
    expect(store.getSnapshot().queue[0]?.position).toBe(4);
  });
});

describe("what the store refuses or hides", () => {
  it("sends no deposit for a node whose attestation it cannot verify", async () => {
    const { node, store } = setup();
    await store.checkNode();
    await connectWallet(store, "browser");
    await attestEligibility(store, "professional");
    node.controls.setAttestationMode("unverifiable");
    await store.checkNode();
    await deposit(store, fixedFromInt(1_000));
    expect(store.getSnapshot().toasts.at(-1)?.text).toContain("will not send a deposit");
    expect(node.client.state.account(store.getSnapshot().wallet?.address ?? "").pending).toEqual([]);
  });

  it("shows the activity of market events and of the connected account only", async () => {
    const { node, store } = await funded();
    const mine = store.getSnapshot().wallet?.address ?? "";
    node.client.state.emit({ type: "tick" }, [
      { type: "deposited", account: "0x2222222222222222222222222222222222222222", amount: "5" },
      { type: "deposited", account: mine, amount: "7" },
      { type: "market_closed", market: 4 },
    ]);
    const text = store.getSnapshot().feed.map((f) => f.text);
    expect(text).toContain("Deposit credited: $7.00");
    expect(text).toContain("US500 closed");
    expect(text).not.toContain("Deposit credited: $5.00");
  });

  it("keeps a withdrawal's amount for the user to correct when the node refuses it", async () => {
    const { store } = await funded();
    expect(await withdraw(store, fixedFromInt(900_000))).toBe(false);
    expect(await withdraw(store, fixedFromInt(1_000))).toBe(true);
  });

  it("does not advance the node's clock backwards", () => {
    const { node, store } = setup();
    store.tick(START + 5_000);
    store.tick(START + 1_000);
    expect(node.client.state.now).toBe(START + 5_000);
  });

  it("reads again when a refresh was asked for while another ran, so a stale answer never stands", async () => {
    const { node, store } = await funded();
    const address = store.getSnapshot().wallet?.address ?? "";
    const stale = await node.client.account(address);
    vi.spyOn(node.client, "account").mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return stale;
    });
    const first = store.refresh(true);
    node.client.state.account(address).balance += fixedFromInt(5);
    const second = store.refresh(true);
    await Promise.all([first, second]);
    expect(store.getSnapshot().account?.balance).toBe((parseFixed(stale.balance) ?? 0n) + fixedFromInt(5));
  });

  it("tells the user when their account is closed out, and when a resting order is cancelled later", async () => {
    const { node, store } = await funded();
    const me = store.getSnapshot().wallet?.address ?? "";
    node.client.state.emit({ type: "tick" }, [{ type: "order_cancelled", account: me, order_id: 7, reason: "unfillable" }]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toContain("could not be filled and was cancelled");
    node.client.state.emit({ type: "tick" }, [{ type: "close_out", account: me, equity: "1", margin: "10" }]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toContain("closed out");
    // Another account's close-out is not the user's news.
    const before = store.getSnapshot().toasts.length;
    node.client.state.emit({ type: "tick" }, [{ type: "close_out", account: "0x2222222222222222222222222222222222222222", equity: "1", margin: "10" }]);
    expect(store.getSnapshot().toasts).toHaveLength(before);
  });
});
