/** Tests for the store driving the mock node through the user's whole path. */

import { describe, expect, it, vi } from "vitest";

import { fixedFromInt, parseFixed } from "../fixed";
import { createMockNode, SIM_EPOCH_MS } from "../mock";
import { resetVault } from "../mock/test-helpers";
import { parseSize, previewTicket } from "../ticket";
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

/** Orders `size` contracts of market 1 as the ticket does: the typed quantity and, for a market order, the price it shows. */
function order(store: ConsoleStore, side: "buy" | "sell", size: string, kind?: { kind: "limit"; price: bigint }) {
  const state = store.getSnapshot();
  const market = state.markets.find((m) => m.id === 1);
  const parsed = parseSize(size);
  if (!market || parsed.kind !== "qty") throw new Error("no market 1, or a size the ticket refuses");
  const preview = previewTicket({ market, side, qty: parsed.qty, slippageBps: 10, resting: kind !== undefined, account: state.account, houseNav: state.house.nav });
  return placeOrder(store, { market: 1, side, qty: preview.qty, kind: kind ?? { kind: "market", quoted: preview.quote?.price ?? 0n, slippageBps: 10 }, reduceOnly: false });
}

const buy = (store: ConsoleStore, size: string, kind?: { kind: "limit"; price: bigint }) => order(store, "buy", size, kind);

/** Closes market 1's whole position as the Positions tab does: its exact quantity, reduce only. */
function closePosition(store: ConsoleStore) {
  const state = store.getSnapshot();
  const market = state.markets.find((m) => m.id === 1);
  const position = state.account?.positions.find((p) => p.market === 1);
  if (!market || !position) throw new Error("no market 1, or no position in it");
  const side = position.qty > 0n ? "sell" : "buy";
  const qty = position.qty < 0n ? -position.qty : position.qty;
  const preview = previewTicket({ market, side, qty, slippageBps: 25, account: state.account, houseNav: state.house.nav });
  return placeOrder(store, { market: 1, side, qty, kind: { kind: "market", quoted: preview.quote?.price ?? 0n, slippageBps: 25 }, reduceOnly: true });
}

describe("the user's path", () => {
  it("accepts the mock attestation, then connects, attests, deposits, and trades", async () => {
    const { store } = await funded();
    const state = store.getSnapshot();
    expect(state.attestation.kind).toBe("mock");
    expect(state.eligibility).toBe("professional");
    expect(state.account?.balance).toBe(fixedFromInt(50_000));
    await buy(store, "0.25");
    expect(store.getSnapshot().account?.positions).toHaveLength(1);
    expect(store.getSnapshot().toasts.at(-1)?.text).toContain("Filled");
    expect(store.getSnapshot().history[0]?.type).toBe("fill");
  });

  it("fills the exact quantity typed, long or short, and closes exactly that quantity", async () => {
    const { store } = await funded();
    const mine = () => store.getSnapshot().account?.positions.find((p) => p.market === 1)?.qty;
    await buy(store, "0.5");
    expect(mine()).toBe(parseFixed("0.5"));
    await closePosition(store);
    expect(mine()).toBeUndefined();
    // A size no notional rounds to, and a short closed by a buy of the same quantity.
    await order(store, "sell", "0.123457");
    expect(mine()).toBe(parseFixed("-0.123457"));
    await closePosition(store);
    expect(mine()).toBeUndefined();
    expect(store.getSnapshot().toasts.at(-1)?.text).toContain("Filled");
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
    await buy(store, "74");
    expect(store.getSnapshot().toasts.at(-1)?.text).toMatch(/equity|house|too|Not enough/i);
    await buy(store, "0.2", { kind: "limit", price: parseFixed("1000") ?? 0n });
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
    // Another account's close-out or cancelled order is not the user's news.
    const before = store.getSnapshot().toasts;
    node.client.state.emit({ type: "tick" }, [{ type: "close_out", account: "0x2222222222222222222222222222222222222222", equity: "1", margin: "10" }]);
    node.client.state.emit({ type: "tick" }, [{ type: "order_cancelled", account: "0x2222222222222222222222222222222222222222", order_id: 9, reason: "unfillable" }]);
    expect(store.getSnapshot().toasts).toEqual(before);
  });
});
