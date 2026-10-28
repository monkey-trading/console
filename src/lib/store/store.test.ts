/** Tests for the store driving the mock node through the user's whole path. */

import { describe, expect, it } from "vitest";

import { fixedFromInt, parseFixed } from "../fixed";
import { createMockNode, SIM_EPOCH_MS } from "../mock";
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
  await ctx.store.refresh(true);
  return ctx;
}

const buy = (store: ConsoleStore, notional: number, kind: Parameters<typeof placeOrder>[1]["kind"] = { type: "market" }) =>
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
    expect(store.getSnapshot().history[0]?.event.type).toBe("fill");
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
    await buy(store, 10_000, { type: "limit", price: parseFixed("1000") ?? 0n });
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
