/** Tests for the reads a 404 holds back (monkey-trading/console#160): how often a node without the House state route, or an account it has not credited, is asked again. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settle } from "../engine/test-kit";
import type { EngineEvent } from "../engine/event-types";
import type { StreamMessage } from "../engine/types";
import { openHousePanel } from "./house";
import { ACCOUNT, setup } from "./live-fake";
import { NOT_CREDITED_MS, ROUTE_ABSENT_MS } from "./quiet-reads";
import { ConsoleStore } from "./store";

const PARAMS = { profitFeeBps: 1000, closeoutLevelBps: 5000, totalCapBps: 20000, totalCapFloor: 0n, seq: 7 };
const message = (seq: number, events: EngineEvent[]): StreamMessage => ({ offset: `${seq}:0`, type: "command", seq, ts: seq, cmd: { type: "deposit" }, events });
/** The credit a deposit's screening retry makes: its one event names the account only inside the receipt, as the node's does (the command's own type is not one the console reads). */
const retryCredit = (seq: number, account: string): StreamMessage => message(seq, [{ type: "custody_deposit_changed", receipt: { beneficiary: { kind: "trader", account } } }]);
const creditedEvent = (seq: number, account = ACCOUNT) => message(seq, [{ type: "deposited", account, amount: "5" }]);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** A started store over a node without the House state route, with the House page open; `close` closes it. */
async function houseOpen() {
  const made = setup();
  made.client.unavailable = true;
  const close = openHousePanel(made.store);
  made.store.start(0);
  await settle();
  return { ...made, close };
}

/** Refreshes `times` times, `gapMs` apart on the fake clock. */
async function refreshEvery(store: ConsoleStore, times: number, gapMs = 1_000) {
  for (let i = 0; i < times; i++) {
    await vi.advanceTimersByTimeAsync(gapMs);
    await store.refresh(false);
    await settle();
  }
}

describe("a node without the House state route", () => {
  it("is asked once, not on every refresh, and the panels say it is not available", async () => {
    const { client, store } = await houseOpen();
    expect(client.houseStateReads).toBe(1);
    await refreshEvery(store, 30);
    expect(client.houseStateReads).toBe(1);
    expect(store.getSnapshot()).toMatchObject({ houseStateStatus: "unavailable", houseParams: null });
    expect(store.getSnapshot().notices).toEqual({});
  });

  it("is asked again once the long back-off has passed, and picks up a route it has gained", async () => {
    const { client, store } = await houseOpen();
    client.unavailable = false;
    client.params = PARAMS;
    await refreshEvery(store, 1, ROUTE_ABSENT_MS - 2_000);
    expect(client.houseStateReads).toBe(1);
    await refreshEvery(store, 1, 2_000);
    expect(client.houseStateReads).toBe(2);
    expect(store.getSnapshot()).toMatchObject({ houseStateStatus: "read", houseParams: PARAMS });
  });

  it("is asked again when the House page opens again, and picks up a route it has gained", async () => {
    const { client, store, close } = await houseOpen();
    close();
    client.unavailable = false;
    client.params = PARAMS;
    openHousePanel(store);
    await settle();
    expect(client.houseStateReads).toBe(2);
    expect(store.getSnapshot()).toMatchObject({ houseStateStatus: "read", houseParams: PARAMS });
  });

  it("is asked again when the stream returns from an outage, which a restarted node causes", async () => {
    const { client, store } = await houseOpen();
    client.listener?.({ type: "feed", status: "stale" });
    client.unavailable = false;
    client.params = PARAMS;
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(client.houseStateReads).toBe(2);
    expect(store.getSnapshot().houseParams).toEqual(PARAMS);
  });

  it("holds back only the 404: a failing read is asked on every refresh", async () => {
    const { client, store } = await houseOpen();
    client.unavailable = false;
    client.houseStateError = new Error("house state down");
    await refreshEvery(store, 1, ROUTE_ABSENT_MS);
    const before = client.houseStateReads;
    await refreshEvery(store, 5);
    expect(client.houseStateReads - before).toBe(5);
  });
});

describe("an account the node has not credited", () => {
  async function connected() {
    const made = setup();
    made.store.start(0);
    await settle();
    made.store.setWallet({ address: ACCOUNT, label: "test" });
    await made.store.refresh(false);
    await settle();
    return made;
  }

  it("is read once per rest, with its entitlement, however often the refresh runs", async () => {
    const { client, store } = await connected();
    expect([client.accountReads, client.emissionsReads]).toEqual([1, 1]);
    await refreshEvery(store, 2); // 2 s on: inside the rest
    expect([client.accountReads, client.emissionsReads]).toEqual([1, 1]);
    await refreshEvery(store, 5, 500); // 4.5 s on in all: one rest has ended
    expect([client.accountReads, client.emissionsReads]).toEqual([2, 2]);
    expect(store.getSnapshot()).toMatchObject({ account: null, entitlement: null, accountRead: true });
  });

  it("is read at once when an event for the account arrives, inside the rest", async () => {
    const { client, store } = await connected();
    client.credited = true;
    client.onMessage?.(creditedEvent(20));
    await settle();
    expect(client.accountReads).toBe(2);
    expect(store.getSnapshot().account).not.toBeNull();
  });

  it("is read at once when the deposit's screening retry credits it, an event that names it only in the receipt", async () => {
    const { client, store } = await connected();
    client.credited = true;
    client.onMessage?.(retryCredit(21, ACCOUNT.toUpperCase().replace("0X", "0x")));
    await settle();
    expect(client.accountReads).toBe(2);
    expect(store.getSnapshot().account).not.toBeNull();
  });

  it("is not held back by a deposit receipt for the house or another account", async () => {
    const { client } = await connected();
    client.credited = true;
    client.onMessage?.(retryCredit(21, "0x00000000000000000000000000000000000000bb"));
    client.onMessage?.(message(22, [{ type: "custody_deposit_changed", receipt: { beneficiary: { kind: "house" } } }]));
    await settle();
    expect(client.accountReads).toBe(1);
  });

  it("is not held back by an event for another account", async () => {
    const { client } = await connected();
    client.credited = true;
    client.onMessage?.(creditedEvent(20, "0x00000000000000000000000000000000000000bb"));
    await settle();
    expect(client.accountReads).toBe(1);
  });

  it("is read again after an event even if a read that began before the event answers 404 after it", async () => {
    const { client, store } = await connected();
    await vi.advanceTimersByTimeAsync(NOT_CREDITED_MS);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const read = client.account.bind(client);
    client.account = async () => { const stale = read(); await gate; return stale; }; // the node answered before the credit; the answer arrives after its event
    const refreshing = store.refresh(false);
    await settle();
    client.credited = true;
    client.onMessage?.(creditedEvent(30));
    release();
    await refreshing;
    await settle();
    expect(store.getSnapshot().account).not.toBeNull(); // the 404 that arrived late did not start a rest that held the credit back
  });

  it("is read on every refresh once credited, and a failing read is never held back", async () => {
    const { client, store } = await connected();
    client.credited = true;
    client.onMessage?.(creditedEvent(20));
    await settle();
    const before = client.accountReads;
    await refreshEvery(store, 5, 100);
    expect(client.accountReads - before).toBe(5);
    client.credited = false;
    client.accountError = new Error("account unavailable");
    const failing = client.accountReads;
    await refreshEvery(store, 3, 100);
    expect(client.accountReads - failing).toBe(3);
  });

  it("is read on every refresh by a node that runs in this page", async () => {
    const { client, store: live } = setup();
    client.signatures = "none";
    const store = new ConsoleStore(live.deps);
    store.start(0);
    await settle();
    store.setWallet({ address: ACCOUNT, label: "test" });
    await refreshEvery(store, 4, 100);
    expect(client.accountReads).toBe(4);
  });

  it("is read again when the stream returns from an outage", async () => {
    const { client } = await connected();
    client.listener?.({ type: "feed", status: "stale" });
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(client.accountReads).toBe(2);
  });
});
