/** Tests for the chart's history while a node that has just taken over is still importing its earlier history (503 with Retry-After). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { barsFromMarks } from "../bars";
import { EngineError } from "../engine/client";
import { settle } from "../engine/test-kit";
import { HISTORY_UNAVAILABLE } from "./bars-scan";
import { BTC, setup } from "./live-fake";

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const entry = (tMs: number) => ({ ts: tMs, open: "100000", high: "100000", low: "100000", close: "100000", provenance: "log_derived" as const });
const notReady = (seconds: number | null = 5) => {
  const error = new EngineError(503, "the marks cache is still taking this node's earlier history");
  error.retryAfterMs = seconds === null ? null : seconds * 1000;
  return error;
};

/** A client whose marks answer `notReady` for the first `refusals` reads, then the one-hour-old page. */
function slowNode(refusals: number, seconds: number | null = 5) {
  const made = setup();
  let left = refusals;
  made.client.marks = async (market, resolution, fromMs, toMs) => {
    made.client.marksReads.push({ market, resolution, fromMs, toMs });
    if (left-- > 0) throw notReady(seconds);
    return { entries: [entry(NOW - 60_000), entry(NOW - 30_000)], next: null };
  };
  return made;
}

describe("history from a node still importing it", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("waits the Retry-After, then fills the history under the live bars, with no notice at any point", async () => {
    const { client, store } = slowNode(2);
    const seen: unknown[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().notices.chart));
    store.start(NOW);
    await settle();
    expect(client.marksReads).toHaveLength(1);
    // Reads the stream prompts meanwhile do not ask again before the wait is over.
    client.onMessage?.({ offset: "1:0", type: "command", seq: 1, ts: NOW + 1_000, cmd: { type: "tick" }, events: [] });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(client.marksReads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.marksReads).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.marksReads).toHaveLength(3);
    const bars = store.getSnapshot().bars[1]?.["1m"] ?? [];
    const times = bars.map((bar) => bar.time);
    expect(times).toEqual([...new Set(times)].sort((a, b) => a - b));
    expect(bars[0]).toMatchObject({ time: (NOW - 60_000) / 1000 });
    expect(bars.slice(0, 1)).toEqual(barsFromMarks([{ ts: NOW - 60_000, mid: 100_000 }, { ts: NOW - 30_000, mid: 100_000 }], 60));
    expect(store.getSnapshot().notices.chart).toBeUndefined();
    expect(seen.every((notice) => notice === undefined)).toBe(true);
  });

  it("keeps the wait within one to thirty seconds", async () => {
    const quick = slowNode(1, 0);
    quick.store.start(NOW);
    await settle();
    await vi.advanceTimersByTimeAsync(999);
    expect(quick.client.marksReads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(quick.client.marksReads).toHaveLength(2);
    const slow = slowNode(1, 3_600);
    slow.store.start(NOW);
    await settle();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(slow.client.marksReads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(slow.client.marksReads).toHaveLength(2);
  });

  it("says the history could not be loaded once the waits run out, and stops asking", async () => {
    const { client, store } = slowNode(Infinity, 30);
    store.start(NOW);
    await settle();
    await vi.advanceTimersByTimeAsync(200_000);
    expect(store.getSnapshot().notices.chart).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.getSnapshot().notices.chart).toMatchObject({ tone: "error", text: HISTORY_UNAVAILABLE });
    const reads = client.marksReads.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.marksReads).toHaveLength(reads);
  });

  it("says so at once for a failure that is not a 503, after the fetch's own tries", async () => {
    const { client, store } = setup();
    client.marks = async (market, resolution, fromMs, toMs) => {
      client.marksReads.push({ market, resolution, fromMs, toMs });
      throw new EngineError(400, "bad request");
    };
    store.start(NOW);
    await settle();
    for (const at of [60_000, 120_000]) {
      await vi.advanceTimersByTimeAsync(1_000);
      client.onMessage?.({ offset: "1:0", type: "command", seq: 1, ts: NOW + at, cmd: { type: "tick" }, events: [] });
      await settle();
    }
    expect(client.marksReads).toHaveLength(3);
    expect(store.getSnapshot().notices.chart).toMatchObject({ text: HISTORY_UNAVAILABLE });
  });

  it("cancels the wait when another market or resolution is shown, so no read lands on the wrong chart", async () => {
    const { client, store } = slowNode(1);
    client.markets = async () => [BTC, { ...BTC, id: 2, symbol: "ETH-USD" }];
    store.start(NOW);
    await settle();
    expect(client.marksReads).toHaveLength(1);
    store.setTimeframe("1h");
    await settle();
    expect(client.marksReads).toHaveLength(2);
    expect(client.marksReads[1]).toMatchObject({ market: 1, resolution: "1h" });
    await vi.advanceTimersByTimeAsync(60_000);
    // The pending 1m wait never fired: the only other read is the 1h one.
    expect(client.marksReads).toHaveLength(2);
    store.select(2);
    await settle();
    expect(client.marksReads.at(-1)).toMatchObject({ market: 2 });
    expect(store.getSnapshot().bars[1]?.["1m"]?.some((bar) => bar.time === (NOW - 60_000) / 1000)).toBe(false);
  });
});
