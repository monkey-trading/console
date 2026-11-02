/** Tests for the store's notices: one per surface, replaced by the next, cleared by what makes them stale, never timed. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockNode, SIM_EPOCH_MS } from "../mock";
import { mockHistory } from "../mock/history";
import { connectWallet, disconnectWallet } from "./actions";
import { prompting } from "./signing";
import { ConsoleStore } from "./store";

function rig() {
  const node = createMockNode(SIM_EPOCH_MS);
  const store = new ConsoleStore({
    client: node.client, wallets: node.wallets, drive: (ms) => node.client.tick(ms), history: mockHistory,
    initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS },
  });
  store.start(SIM_EPOCH_MS);
  return store;
}

afterEach(() => vi.useRealTimers());

describe("notify and clearNotice", () => {
  it("keeps one message per surface, the newest replacing the last", () => {
    const store = rig();
    store.notify("ticket", "first");
    store.notify("ticket", "second");
    store.notify("orders", "other", "info");
    const { notices } = store.getSnapshot();
    expect(notices.ticket).toMatchObject({ tone: "error", text: "second" });
    expect(notices.orders).toMatchObject({ tone: "info", text: "other" });
  });

  it("gives a repeat of the same text a new id, so it is announced again", () => {
    const store = rig();
    store.notify("ticket", "same");
    const first = store.getSnapshot().notices.ticket?.id;
    store.notify("ticket", "same");
    expect(store.getSnapshot().notices.ticket?.id).not.toBe(first);
  });

  it("clears only the surfaces named, and tells nobody when they held nothing", () => {
    const store = rig();
    store.notify("ticket", "a");
    store.notify("orders", "b");
    const heard = vi.fn();
    store.subscribe(heard);
    store.clearNotice("deposit");
    expect(heard).not.toHaveBeenCalled();
    store.clearNotice("ticket");
    expect(Object.keys(store.getSnapshot().notices)).toEqual(["orders"]);
  });

  it("never expires on a timer", () => {
    vi.useFakeTimers();
    const store = rig();
    store.notify("withdraw", "The node refused the withdrawal.");
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(store.getSnapshot().notices.withdraw?.text).toBe("The node refused the withdrawal.");
  });
});

describe("what makes a notice stale", () => {
  it("is a change of wallet, which leaves what is about the node, the feed and the chart", async () => {
    const store = rig();
    for (const surface of ["ticket", "orders", "positions", "deposit", "withdraw", "payouts", "emissions", "stake", "settings", "account", "accountRead"] as const) store.notify(surface, "old wallet");
    for (const surface of ["node", "feed", "chart"] as const) store.notify(surface, "kept");
    await connectWallet(store, "browser");
    expect(Object.keys(store.getSnapshot().notices).sort()).toEqual(["chart", "feed", "node"]);
  });

  it("is a new connect, for how the last connection ended", async () => {
    const store = rig();
    store.notify("wallet", "This browser's trading authorization expired, so your wallet was disconnected.", "info");
    await connectWallet(store, "browser");
    expect(store.getSnapshot().notices.wallet).toBeUndefined();
  });

  it("is selecting another market, for a refused order and a chart that failed to load", () => {
    const store = rig();
    const other = store.getSnapshot().markets.find((m) => m.id !== store.getSnapshot().selected);
    store.notify("ticket", "refused");
    store.notify("chart", "history unavailable");
    store.notify("orders", "kept");
    if (other === undefined) throw new Error("the mock lists several markets");
    store.select(other.id);
    expect(Object.keys(store.getSnapshot().notices)).toEqual(["orders"]);
  });
});

describe("the wallet's pending request", () => {
  it("shows on the surface that asked while the wallet waits, and goes when the step ends, however it ends", async () => {
    const store = rig();
    await connectWallet(store, "browser");
    const wallet = store.liveWallet;
    let during: unknown;
    await prompting(store, wallet, "withdraw", "Confirm in your wallet: withdraw 100 USDC.", async (progress) => {
      during = store.getSnapshot().promptAt;
      progress("Waiting for the transaction.");
      expect(store.getSnapshot()).toMatchObject({ prompt: "Waiting for the transaction.", promptAt: "withdraw" });
    });
    expect(during).toBe("withdraw");
    expect(store.getSnapshot()).toMatchObject({ prompt: null, promptAt: null });
    await expect(prompting(store, wallet, "deposit", "Confirm", () => Promise.reject(new Error("declined")))).rejects.toThrow("declined");
    expect(store.getSnapshot()).toMatchObject({ prompt: null, promptAt: null });
  });

  it("is dropped with the connection, and a step of the old connection neither writes nor clears it", async () => {
    const store = rig();
    await connectWallet(store, "browser");
    const old = store.liveWallet;
    let release: () => void = () => undefined;
    const waiting = prompting(store, old, "ticket", "Confirm", () => new Promise<void>((resolve) => { release = resolve; }));
    expect(store.getSnapshot().promptAt).toBe("ticket");
    disconnectWallet(store);
    expect(store.getSnapshot()).toMatchObject({ prompt: null, promptAt: null });
    store.patch({ prompt: "the next connection's", promptAt: "deposit" });
    release();
    await waiting;
    expect(store.getSnapshot()).toMatchObject({ prompt: "the next connection's", promptAt: "deposit" });
  });
});
