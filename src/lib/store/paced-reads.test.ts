/** Tests for a live store's paced reads: ticks read the node at a bounded rate, an account event reads at once, and `prices` commands move the marks between reads. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fixedFromWire } from "../fixed";
import { settle } from "../engine/test-kit";
import type { EngineEvent } from "../engine/event-types";
import type { EngineCommand, StreamMessage } from "../engine/types";
import { ACCOUNT, BTC, setup } from "./live-fake";
import { ConsoleStore } from "./store";

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const message = (seq: number, ts: number, cmd: EngineCommand, events: EngineEvent[] = []): StreamMessage => ({ offset: `${seq}:0`, type: "command", seq, ts, cmd, events });
const tick = (seq: number, ts: number) => message(seq, ts, { type: "tick" });
const prices = (seq: number, ts: number, mids: [string, string], events: EngineEvent[] = []) =>
  message(seq, ts, { type: "prices", market: 1, quotes: [{ source: "a", mid: mids[0], ts }, { source: "b", mid: mids[1], ts }] }, events);
const markOf = (store: ReturnType<typeof setup>["store"]) => store.getSnapshot().markets[0]?.mark;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** A started live store whose first read has landed, at log seq 10. */
async function started() {
  const made = setup();
  made.client.headSeq = 10;
  made.store.start(T0);
  await settle();
  return made;
}

describe("reads prompted by ticks", () => {
  it("makes one read for many ticks in a second", async () => {
    const { client } = await started();
    const before = client.marketReads;
    for (let i = 0; i < 40; i++) client.onMessage?.(tick(11 + i, T0 + i * 25));
    await settle();
    expect(client.marketReads - before).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(client.marketReads - before).toBe(1);
  });

  it("reads once more when the wait ends, so the last tick's state is never missed", async () => {
    const { client } = await started();
    const before = client.marketReads;
    for (let i = 0; i < 40; i++) client.onMessage?.(tick(11 + i, T0 + i * 25));
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(client.marketReads - before).toBe(2);
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(client.marketReads - before).toBe(2); // nothing waiting: the quiet node is not read
  });

  it("reads the connected account's event at once, without waiting for the interval", async () => {
    const { client, store } = await started();
    store.setWallet({ address: ACCOUNT, label: "test" });
    client.onMessage?.(tick(11, T0 + 10)); // starts the wait
    await settle();
    const before = client.marketReads;
    client.onMessage?.(message(12, T0 + 20, { type: "deposit" }, [{ type: "deposited", account: ACCOUNT, amount: "5" }]));
    await settle();
    expect(client.marketReads - before).toBe(1);
  });

  it("reads a node that runs in this page on every tick", async () => {
    const { client, store } = setup();
    client.signatures = "none";
    const mock = new ConsoleStore(store.deps);
    mock.start(T0);
    await settle();
    const before = client.marketReads;
    for (let i = 0; i < 3; i++) {
      client.onMessage?.(tick(11 + i, T0 + i * 25));
      await settle();
    }
    expect(client.marketReads - before).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops its timer with the store, and a restart leaves none behind", async () => {
    const { client, store } = await started();
    const stop = store.start(T0);
    client.onMessage?.(tick(11, T0 + 10));
    client.onMessage?.(tick(12, T0 + 20));
    await settle();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    const before = client.marketReads;
    stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(client.marketReads).toBe(before); // the held trailing read did not run after the stop
    // StrictMode: start, stop, start leaves the one live cycle's timers only.
    const again = store.start(T0);
    again();
    store.start(T0)();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("marks between reads", () => {
  /** Streams two `prices` commands a freshness window apart so the book is warm, then returns the mark shown. */
  async function warm() {
    const made = await started();
    made.client.onMessage?.(prices(11, T0, ["100000", "100002"]));
    made.client.onMessage?.(prices(12, T0 + 1_001, ["100010", "100020"]));
    return made;
  }

  it("follows the engine's index from the stream, with no read", async () => {
    const { client, store } = await warm();
    const reads = client.marketReads;
    expect(markOf(store)).toBe(fixedFromWire("100015"));
    expect(client.marketReads).toBe(reads);
  });

  it("shows no mark until the quotes the node held at the first read have aged out", async () => {
    const { client, store } = await started();
    client.onMessage?.(prices(11, T0, ["100050", "100052"]));
    client.onMessage?.(prices(12, T0 + 1_000, ["100060", "100062"])); // a quote exactly one window old still counts
    expect(markOf(store)).toBe(fixedFromWire("100000"));
  });

  it("plots the streamed mark on the chart bars", async () => {
    const { store } = await warm();
    expect(store.getSnapshot().bars[1]?.["1m"]?.at(-1)?.close).toBe(100_015);
  });

  it("shows at most a few updates a second however fast prices arrive", async () => {
    const { client, store } = await warm();
    let patches = 0;
    store.subscribe(() => { patches++; });
    for (let i = 0; i < 67; i++) {
      client.onMessage?.(prices(13 + i, T0 + 1_100 + i * 15, [String(100_100 + i), String(100_100 + i)]));
      await vi.advanceTimersByTimeAsync(15);
    }
    expect(patches).toBeLessThanOrEqual(6);
    expect(markOf(store)).toBe(fixedFromWire("100166"));
  });

  it("keeps a streamed mark newer than the read, and takes the read's mark when it is newer", async () => {
    const { client, store } = await warm();
    client.marketList = [{ ...BTC, mark: "100001" }];
    client.headSeq = 11; // the answer predates the stream's seq 12
    client.onMessage?.(tick(13, T0 + 1_100));
    await settle();
    expect(markOf(store)).toBe(fixedFromWire("100015"));
    client.headSeq = 40;
    client.onMessage?.(tick(14, T0 + 1_200));
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(markOf(store)).toBe(fixedFromWire("100001"));
  });

  it("leaves the mark to the read after a rejection the fold does not model", async () => {
    const { client, store } = await warm();
    client.onMessage?.(prices(13, T0 + 1_100, ["100200", "100202"], [{ type: "prices_rejected", market: 1, reason: "quote units are blocked by a failed split" }]));
    client.onMessage?.(prices(14, T0 + 1_200, ["100300", "100302"])); // the book starts over, so this one is not shown either
    await vi.advanceTimersByTimeAsync(300);
    expect(markOf(store)).toBe(fixedFromWire("100015"));
  });

  it.each([
    "malformed quote from c",
    "quote from c stamped 5000ms ahead of the sequenced time",
    "quote from c stamped or sequenced outside one open session",
  ])("keeps a rejection the fold applies itself (%s) from costing the stream's marks", async (reason) => {
    const { client, store } = await warm();
    client.onMessage?.(prices(13, T0 + 1_100, ["100200", "100202"], [{ type: "prices_rejected", market: 1, reason }]));
    await vi.advanceTimersByTimeAsync(300);
    expect(markOf(store)).toBe(fixedFromWire("100201"));
  });

  it("leaves the mark to the read after an admin command", async () => {
    const { client, store } = await warm();
    client.onMessage?.(message(13, T0 + 1_100, { type: "admin" } as StreamMessage["cmd"]));
    client.onMessage?.(prices(14, T0 + 1_200, ["100300", "100302"]));
    await vi.advanceTimersByTimeAsync(300);
    expect(markOf(store)).toBe(fixedFromWire("100015"));
  });
});
