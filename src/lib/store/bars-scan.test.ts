/** Tests for the chart's history scan: retries with backoff, a visible failure, exclusions, and the log-head precondition. */

import { describe, expect, it } from "vitest";

import { flush, MARKS, storeOver, T } from "./bars-scan-kit";
import { BTC, FakeClient } from "./live-fake";

describe("the chart's history scan", () => {
  it("scans the log back from the head after the first markets read and seeds every timeframe's bars with the marks", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    client.scanned = [
      { market: 1, ts: T - 86_400_000, mid: 90 },
      { market: 1, ts: T - 3_600_000, mid: 95 },
      { market: 1, ts: T - 60_000, mid: 100 },
      { market: 1, ts: T, mid: 101 },
    ];
    const store = storeOver(client);
    store.start(0);
    await flush();
    expect(client.scans).toHaveLength(1);
    expect(client.scans[0]?.fromSeq).toBe(440_000);
    const bars = store.getSnapshot().bars[1];
    if (!bars) throw new Error("no bars seeded");
    // Each timeframe aggregates the marks into its own buckets, ending at the newest mark.
    const expected: Record<string, { closes: number[] }> = {
      "1m": { closes: [90, 95, 100, 101] },
      "5m": { closes: [90, 95, 100, 101] },
      "15m": { closes: [90, 95, 100, 101] },
      "1h": { closes: [90, 100, 101] }, // the hour bucket holds both the T-1h and the T-1m marks
      "1D": { closes: [90, 101] }, // the day before sits in its own day bucket
    };
    for (const [id, want] of Object.entries(expected)) {
      expect(bars[id as keyof typeof bars]?.map((b) => b.close)).toEqual(want.closes);
    }
  });

  it("tries again, 3 s apart, when a scan fails, and seeds the bars once an attempt succeeds", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let attempts = 0;
    let failures = 0;
    client.scanMarks = async () => {
      attempts++;
      if (failures++ < 2) throw new Error("The connection to the node failed while scanning the log (code 1006).");
      return MARKS;
    };
    const waits: number[] = [];
    const store = storeOver(client, { wait: async (ms) => void waits.push(ms) });
    store.start(0);
    await flush();
    expect(attempts).toBe(3);
    expect(waits).toEqual([3_000, 3_000]);
    expect(store.getSnapshot().toasts.some((t) => t.text.includes("Chart history"))).toBe(false);
    expect(store.getSnapshot().bars[1]?.["1m"]).toHaveLength(2);
  });

  it("toasts the reason once the retries are spent, and does not scan again on later reads", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let attempts = 0;
    client.scanMarks = async () => { attempts++; throw new Error("The node's archive answered HTTP 503."); };
    const waits: number[] = [];
    const store = storeOver(client, { wait: async (ms) => void waits.push(ms) });
    store.start(0);
    await flush();
    expect(attempts).toBe(3);
    expect(waits).toEqual([3_000, 3_000]);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "error", text: "Chart history unavailable: The node's archive answered HTTP 503." });
    await store.refresh(false);
    await flush();
    expect(attempts).toBe(3);
  });

  it("does not scan before the node has named a log head, and scans on the read that first names one", async () => {
    const client = new FakeClient();
    client.scanned = MARKS;
    const store = storeOver(client);
    store.start(0);
    await flush();
    expect(client.scans).toHaveLength(0);
    client.headSeq = 500_000;
    await store.refresh(false);
    await flush();
    expect(client.scans).toHaveLength(1);
    expect(store.getSnapshot().bars[1]?.["1m"]).toHaveLength(2);
  });

  it("does not scan futures-priced markets, whose roll-adjusted index a bounded log read cannot reconstruct", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    const US500: typeof BTC = {
      ...BTC,
      id: 2,
      symbol: "US500",
      contracts: [{ contract: "ESZ6", from: "2026-09-18T00:00:00Z" }],
    };
    client.marketList = [BTC, US500];
    client.scanned = MARKS;
    const store = storeOver(client);
    store.start(0);
    await flush();
    expect(Object.keys(client.scans[0]?.rules ?? {})).toEqual(["1"]);
    // The markets read frames every listed market; the scan seeds nothing for the futures market.
    expect(store.getSnapshot().bars[2]?.["1m"]).toHaveLength(0);
    expect(store.getSnapshot().bars[1]?.["1m"]).toHaveLength(2);
  });

  it("does not scan markets quoted in another currency, whose marks the engine withholds while the FX index is invalid", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    const EU_INDEX: typeof BTC = { ...BTC, id: 2, symbol: "DE40", quote_currency: { currency: "eur", fx_market: 3 } };
    client.marketList = [BTC, EU_INDEX];
    client.scanned = MARKS;
    const store = storeOver(client);
    store.start(0);
    await flush();
    expect(Object.keys(client.scans[0]?.rules ?? {})).toEqual(["1"]);
    expect(store.getSnapshot().bars[2]?.["1m"]).toHaveLength(0);
    expect(store.getSnapshot().bars[1]?.["1m"]).toHaveLength(2);
  });

  it("scans anew when the store restarts, discarding the previous cycle's pending scan", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    const pending: ((marks: typeof MARKS) => void)[] = [];
    client.scanMarks = () => new Promise((resolve) => { pending.push(resolve); });
    const store = storeOver(client);
    const stopFirst = store.start(0);
    await flush();
    expect(pending).toHaveLength(1);
    stopFirst();
    // React StrictMode re-runs the effect: the same store starts again.
    store.start(0);
    await store.refresh(false); // the markets read that follows a start is what starts the scan
    await flush();
    expect(pending).toHaveLength(2);
    pending[0]?.(MARKS); // the abandoned cycle's late result is discarded
    await flush();
    expect(store.getSnapshot().bars[1]?.["1m"] ?? []).toHaveLength(0);
    pending[1]?.(MARKS); // the current cycle's scan seeds the bars
    await flush();
    expect(store.getSnapshot().bars[1]?.["1m"]).toHaveLength(2);
  });

  it("stands its retries down when the store stops during the wait", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let attempts = 0;
    client.scanMarks = async () => {
      attempts++;
      throw new Error("The connection to the node failed while scanning the log (code 1006).");
    };
    let releaseWait: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { releaseWait = resolve; });
    const store = storeOver(client, { wait: async () => gate });
    const stop = store.start(0);
    await flush();
    expect(attempts).toBe(1); // the first attempt failed and is waiting to retry
    stop();
    releaseWait?.();
    await flush();
    expect(attempts).toBe(1); // the abandoned store retries no further
    expect(store.getSnapshot().toasts.some((t) => t.text.includes("Chart history"))).toBe(false);
  });

  it("seeds nothing when a pending scan finishes after the store stopped", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    const stop = store.start(0);
    await flush();
    stop();
    resolveScan?.(MARKS);
    await flush();
    expect(store.getSnapshot().bars[1]?.["1m"] ?? []).toHaveLength(0);
  });

  it("does not scan equities either, whose quotes a failed corporate action can block without state the scan replays", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    const SHARE: typeof BTC = { ...BTC, id: 2, symbol: "ACME", asset_class: "equity" };
    client.marketList = [BTC, SHARE];
    client.scanned = MARKS;
    const store = storeOver(client);
    store.start(0);
    await flush();
    expect(Object.keys(client.scans[0]?.rules ?? {})).toEqual(["1"]);
    expect(store.getSnapshot().bars[2]?.["1m"]).toHaveLength(0);
    expect(store.getSnapshot().bars[1]?.["1m"]).toHaveLength(2);
  });
});
