/** Tests for the store's house panel state: the node's house state (parameters and latest checkpoint) and the withdrawal queue's totals. */

import { describe, expect, it, vi } from "vitest";

import { fixedFromWire } from "../fixed";
import { QueueTotalsRetrying } from "../engine/live-queue";
import { settle } from "../engine/test-kit";
import { loadAccount } from "./account";
import { openHousePanel } from "./house";
import { ACCOUNT, setup as setupClosed } from "./live-fake";

const PARAMS = { profitFeeBps: 1000, closeoutLevelBps: 5000, totalCapBps: 20000, totalCapFloor: fixedFromWire("2000000"), seq: 7 };
const CHECKPOINT = { type: "checkpoint" as const, offset: "1200:1", seq: 1200, root: `0x${"ab".repeat(32)}` };

/** A store with the House page on screen, as the panel's reads need. */
function setup(...args: Parameters<typeof setupClosed>) {
  const session = setupClosed(...args);
  openHousePanel(session.store);
  return session;
}

describe("the store's house panel state", () => {
  it("starts with nothing read and the figures gated off for a live node", () => {
    const { store } = setup();
    const state = store.getSnapshot();
    expect(state).toMatchObject({ houseReady: false, houseParams: null, checkpoint: null, withdrawalTotals: null });
  });

  it("patches the parameters, checkpoint and queue totals a refresh reads", async () => {
    const { client, store } = setup();
    client.params = PARAMS;
    client.checkpoint = CHECKPOINT;
    client.totals = { count: 2, remaining: fixedFromWire("30.5"), largest: null, head: null, seq: 9, complete: true, stable: true };
    store.start(0);
    await settle();
    const state = store.getSnapshot();
    expect(state.houseReady).toBe(true);
    expect(state.house.cash).toBe(fixedFromWire("5"));
    expect(state.houseParams).toEqual(PARAMS);
    expect(state.checkpoint).toEqual(CHECKPOINT);
    expect(state.withdrawalTotals).toEqual({ count: 2, remaining: fixedFromWire("30.5"), largest: null, head: null, seq: 9, complete: true, stable: true });
  });

  it("marks the house figures ready once a refresh has read them", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    // The canned client fails nothing: the refresh ran, so the figures stand.
    expect(store.getSnapshot().houseReady).toBe(true);
    expect(client.marketReads).toBe(1);
  });

  it("still refreshes the house panel when an account read fails", async () => {
    const { client, store } = setup();
    client.params = PARAMS;
    client.accountError = new Error("account unavailable");
    store.start(0);
    await settle();
    // The house reads fire before the account reads and outside their error handling.
    expect(store.getSnapshot().houseParams).toEqual(PARAMS);
  });

  it("marks retained figures not fresh after a failed refresh, and fresh again on recovery", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    expect(store.getSnapshot().houseFresh).toBe(true);
    client.marketError = new Error("markets down");
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().houseFresh).toBe(false);
    client.marketError = null;
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().houseFresh).toBe(true);
  });

  it("leaves fresh figures fresh when an account read fails, reporting the failure once", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    expect(store.getSnapshot().houseFresh).toBe(true);
    store.setWallet({ address: ACCOUNT, label: "Test wallet" });
    client.accountError = new Error("account unavailable");
    await store.refresh(false);
    await settle();
    // The account failure cannot stale the figures the markets and house reads just refreshed.
    expect(store.getSnapshot().houseFresh).toBe(true);
    expect(store.getSnapshot().toasts.some((t) => t.text === "account unavailable")).toBe(true);
    // The same failure on the next refresh is not shown twice.
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().toasts.filter((t) => t.text === "account unavailable")).toHaveLength(1);
    // Recovery clears the latch: a different failure shows again.
    client.accountError = new Error("account still unavailable");
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().toasts.some((t) => t.text === "account still unavailable")).toBe(true);
    // A new wallet's identical failure is reported: the latch does not carry over.
    store.setWallet({ address: "0x00000000000000000000000000000000000000bb", label: "Other" });
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().toasts.filter((t) => t.text === "account still unavailable")).toHaveLength(2);
  });

  it("still refreshes the house panel when the markets read fails", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    expect(store.getSnapshot().houseFresh).toBe(true);
    // Arm the panel's sources only after the first refresh: the failing refresh's reads are what
    // this asserts.
    client.params = PARAMS;
    client.checkpoint = CHECKPOINT;
    client.totals = { count: 2, remaining: fixedFromWire("30.5"), largest: null, head: null, seq: 9, complete: true, stable: true };
    client.marketError = new Error("markets down");
    await store.refresh(false);
    await settle();
    // The house panel's reads have their own sources and schedule; the failed markets read must
    // not stop them, and the retained figures stand marked not fresh.
    const state = store.getSnapshot();
    expect(state.houseParams).toEqual(PARAMS);
    expect(state.checkpoint).toEqual(CHECKPOINT);
    expect(state.withdrawalTotals).toEqual({ count: 2, remaining: fixedFromWire("30.5"), largest: null, head: null, seq: 9, complete: true, stable: true });
    expect(state.houseFresh).toBe(false);
  });

  it("latches the queue walk's original failure through its backoff waits", async () => {
    const { client, store } = setup();
    client.totalsError = new Error("queue down");
    store.start(0);
    await settle();
    expect(store.getSnapshot().toasts.filter((t) => t.text === "queue down")).toHaveLength(1);
    // The backoff waits reject with their own marker: the original failure stays latched and the
    // wait's message never toasts, however many refreshes the backoff spans.
    client.totalsError = new QueueTotalsRetrying();
    await store.refresh(false);
    await settle();
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().toasts.filter((t) => t.text === "queue down")).toHaveLength(1);
    expect(store.getSnapshot().toasts.filter((t) => t.text.includes("waiting to retry"))).toHaveLength(0);
    // Recovery clears the latch, so the next failure shows again.
    client.totalsError = null;
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().queueFailed).toBe(false);
    client.totalsError = new Error("queue down");
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().toasts.filter((t) => t.text === "queue down")).toHaveLength(2);
  });

  it("starts no house reads once the session has stopped", async () => {
    const { client, store } = setup();
    const stop = store.start(0);
    stop();
    await settle();
    expect(client.houseStateReads).toBe(0);
  });

  it("shows an empty log as read, with no parameters and no checkpoint", async () => {
    const { client, store } = setup();
    client.houseSeq = null;
    store.start(0);
    await settle();
    expect(store.getSnapshot()).toMatchObject({ houseStateStatus: "read", houseParams: null, checkpoint: null });
    expect(client.houseStateReads).toBe(1);
  });

  it("keeps the parameters whose seq the node does not know", async () => {
    const { client, store } = setup();
    client.houseSeq = 40;
    client.params = { ...PARAMS, seq: null };
    store.start(0);
    await settle();
    expect(store.getSnapshot()).toMatchObject({ houseStateStatus: "read", houseParams: { seq: null, profitFeeBps: 1000 } });
  });

  it("reports a failed read once and shows the panels as waiting, then reads on recovery", async () => {
    const { client, store } = setup();
    client.houseStateError = new Error("house state down");
    store.start(0);
    await settle();
    await store.refresh(false);
    await settle();
    const state = store.getSnapshot();
    expect(state.toasts.filter((t) => t.text === "house state down")).toHaveLength(1);
    expect(state).toMatchObject({ houseStateStatus: "pending", houseParams: null, checkpoint: null });
    client.houseStateError = null;
    client.params = PARAMS;
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot()).toMatchObject({ houseStateStatus: "read", houseParams: PARAMS });
    client.houseStateError = new Error("house state down");
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().toasts.filter((t) => t.text === "house state down")).toHaveLength(2); // recovery cleared the latch
  });

  it("shows a node that predates the route as not available, with no toast and no failure", async () => {
    const { client, store } = setup();
    client.unavailable = true;
    client.params = PARAMS;
    store.start(0);
    await settle();
    await store.refresh(false);
    await settle();
    const state = store.getSnapshot();
    expect(state).toMatchObject({ houseStateStatus: "unavailable", houseParams: null, checkpoint: null, houseReady: true });
    expect(state.toasts).toHaveLength(0);
    expect(state.withdrawalTotals).not.toBeNull(); // the rest of the page still reads
  });

  it("publishes the parameters and checkpoint when the queue walk fails", async () => {
    const { client, store } = setup();
    client.params = PARAMS;
    client.checkpoint = CHECKPOINT;
    client.totalsError = new Error("queue unavailable");
    store.start(0);
    await settle();
    const state = store.getSnapshot();
    expect(state.houseParams).toEqual(PARAMS);
    expect(state.checkpoint).toEqual(CHECKPOINT);
    expect(state.withdrawalTotals).toBeNull();
    expect(state.toasts.some((t) => t.text === "queue unavailable")).toBe(true);
  });
});

describe("the house panel's reads, by whether the page is on screen", () => {
  it("reads nothing while the House page is closed, though the house figures still load", async () => {
    const { client, store } = setupClosed();
    client.params = PARAMS;
    client.checkpoint = CHECKPOINT;
    client.totals = { count: 2, remaining: fixedFromWire("30.5"), largest: null, head: null, seq: 9, complete: true, stable: true };
    store.start(0);
    await settle();
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot()).toMatchObject({ houseReady: true, houseParams: null, checkpoint: null, withdrawalTotals: null });
    expect(client.houseStateReads).toBe(0);
    expect(store.getSnapshot().houseStateStatus).toBe("pending");
  });

  it("reads at once when the page opens after the first refresh, and stops when it closes", async () => {
    const { client, store } = setupClosed();
    client.params = PARAMS;
    store.start(0);
    await settle();
    const close = openHousePanel(store);
    await settle();
    expect(store.getSnapshot().houseParams).toEqual(PARAMS);
    close();
    expect(client.houseStateReads).toBe(1);
    client.params = { ...PARAMS, seq: 8 };
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().houseParams).toEqual(PARAMS); // closed: the newer answer was never read
    expect(client.houseStateReads).toBe(1);
  });

  it("starts the dashboard feeds with the page and stops them when it closes", async () => {
    vi.useFakeTimers();
    try {
      const { store } = setupClosed();
      const reads: string[] = [];
      store.houseStats.follow({ key: "probe", everyMs: 30_000, read: async () => { reads.push("read"); return 1; } });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(reads).toEqual([]); // followed, but the page is not open
      const close = openHousePanel(store);
      await vi.advanceTimersByTimeAsync(0);
      expect(reads).toHaveLength(1);
      close();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(reads).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call the connected account's queue read until a read of it has succeeded", async () => {
    const { client, store } = setupClosed();
    store.setWallet({ address: ACCOUNT, label: "watch" });
    expect(store.getSnapshot().accountQueueRead).toBe(false);
    client.accountError = new Error("the node stalled");
    await loadAccount(store, false);
    expect(store.getSnapshot()).toMatchObject({ accountQueueRead: false, queue: [] });
    client.accountError = null;
    await loadAccount(store, false);
    expect(store.getSnapshot().accountQueueRead).toBe(true);
    store.setWallet(null);
    expect(store.getSnapshot().accountQueueRead).toBe(false);
  });
});
