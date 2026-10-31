/** Tests for seeding the chart's bars from the node's marks endpoint, and its archive-scan fallback. */

import { describe, expect, it } from "vitest";

import { barsFromMarks } from "../bars";
import { EngineError } from "../engine/client";
import { MARKS_PAGE_LIMIT } from "../engine/marks-fetch";
import { settle } from "../engine/test-kit";
import type { StreamMessage } from "../engine/types";
import type { MarkPage, MarkProvenance } from "../engine/mark-types";
import { scanBarsHistory } from "./bars-scan";
import { BTC, setup } from "./live-fake";

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const entry = (tMs: number, provenance: MarkProvenance = "log_derived") => ({ ts: tMs, open: "100000", high: "100000", low: "100000", close: "100000", provenance });
const tick = (ts: number): StreamMessage => ({ offset: "1:0", type: "command", seq: 1, ts, cmd: { type: "tick" }, events: [] });
/** The one-bar series the stream's read builds at the current mark and time. */
const streamBar = (seconds: number, at = NOW) => ({
  time: Math.floor(at / 1000 / seconds) * seconds,
  open: 100_000,
  high: 100_000,
  low: 100_000,
  close: 100_000,
  observedHigh: 100_000,
  observedLow: 100_000,
});

describe("seeding the chart from the marks endpoint", () => {
  it("replaces the selected market's active timeframe after the first live read, merging the stream's current bar", async () => {
    const { client, store } = setup();
    client.marksPages = [{ entries: [entry(NOW - 60_000), entry(NOW - 30_000), entry(NOW - 5_000)], next: null }];
    store.start(NOW);
    await settle();
    const marks = [{ ts: NOW - 60_000, mid: 100_000 }, { ts: NOW - 30_000, mid: 100_000 }, { ts: NOW - 5_000, mid: 100_000 }];
    expect(store.getSnapshot().bars[1]?.["1m"]).toEqual([...barsFromMarks(marks, 60), streamBar(60)]);
    // The 5m series is the one the stream's tick built at the current mark, not the endpoint's.
    expect(store.getSnapshot().bars[1]?.["5m"]).toEqual([streamBar(300)]);
    expect(client.marksReads).toHaveLength(1);
    expect(client.marksReads[0]).toMatchObject({ market: 1, resolution: "1m", toMs: NOW });
  });

  it("fetches the new timeframe's resolution on a switch, and seeds each series once", async () => {
    const { client, store } = setup();
    client.marksPages = [
      { entries: [entry(NOW - 60_000)], next: null },
      { entries: [entry(NOW - 3_600_000), entry(NOW - 5_000)], next: null },
    ];
    store.start(NOW);
    await settle();
    expect(client.marksReads).toHaveLength(1);
    store.setTimeframe("1h");
    await settle();
    expect(client.marksReads).toHaveLength(2);
    expect(client.marksReads[1]).toMatchObject({ resolution: "1h" });
    const marks = [{ ts: NOW - 3_600_000, mid: 100_000 }, { ts: NOW - 5_000, mid: 100_000 }];
    expect(store.getSnapshot().bars[1]?.["1h"]).toEqual([...barsFromMarks(marks, 3_600), streamBar(3_600)]);
    store.setTimeframe("1m");
    await settle();
    expect(client.marksReads).toHaveLength(2);
  });

  it("seeds a market the stream has no bars for yet, such as one first seen closed", async () => {
    const { client, store } = setup();
    client.markets = async () => [{ ...BTC, open: false, mark: null }];
    client.marksPages = [{ entries: [entry(NOW - 60_000), entry(NOW - 5_000)], next: null }];
    store.start(NOW);
    await settle();
    const marks = [{ ts: NOW - 60_000, mid: 100_000 }, { ts: NOW - 5_000, mid: 100_000 }];
    expect(store.getSnapshot().bars[1]?.["1m"]).toEqual(barsFromMarks(marks, 60));
    expect(client.marksReads).toHaveLength(1);
  });

  it("merges the ticks the stream delivered during the fetch into the fetched window's last bucket", async () => {
    const { client, store } = setup();
    let release: ((page: MarkPage) => void) | undefined;
    client.marks = () => new Promise<MarkPage>((resolve) => { release = resolve; });
    // The fetch's cutoff lands inside the bucket the stream is building, so the last fetched
    // bucket and the stream's current bar are one.
    store.start(NOW + 10_000);
    await settle();
    client.markets = async () => [{ ...BTC, mark: "200000" }];
    client.onMessage?.(tick(NOW + 20_000));
    await settle();
    release?.({ entries: [entry(NOW - 60_000), { ts: NOW + 5_000, open: "150000", high: "150000", low: "150000", close: "150000", provenance: "log_derived" }], next: null });
    await settle();
    expect(store.getSnapshot().bars[1]?.["1m"]).toEqual([
      { time: (NOW - 60_000) / 1000, open: 100_000, high: 100_000, low: 100_000, close: 100_000, observedHigh: 100_000, observedLow: 100_000 },
      { time: NOW / 1000, open: 150_000, high: 200_000, low: 100_000, close: 200_000, observedHigh: 200_000, observedLow: 100_000 },
    ]);
  });

  it("starts one fetch when triggers arrive while a fetch is pending", async () => {
    const { client, store } = setup();
    let release: ((page: MarkPage) => void) | undefined;
    let calls = 0;
    client.marks = () => {
      calls++;
      return new Promise<MarkPage>((resolve) => { release = resolve; });
    };
    store.start(NOW);
    await settle();
    client.onMessage?.(tick(NOW + 60_000));
    client.onMessage?.(tick(NOW + 120_000));
    await settle();
    expect(calls).toBe(1);
    release?.({ entries: [entry(NOW - 60_000)], next: null });
    await settle();
    expect(store.getSnapshot().bars[1]?.["1m"]?.[0]).toMatchObject({ time: (NOW - 60_000) / 1000 });
  });

  it("retries a transiently failing fetch and recovers the history", async () => {
    const { client, store } = setup();
    let failures = 2;
    client.marks = async () => {
      if (failures-- > 0) throw new Error("The node did not answer.");
      return { entries: [entry(NOW - 60_000)], next: null };
    };
    store.start(NOW);
    await settle();
    client.onMessage?.(tick(NOW + 60_000));
    await settle();
    client.onMessage?.(tick(NOW + 120_000));
    await settle();
    const bars = store.getSnapshot().bars[1]?.["1m"] ?? [];
    expect(bars[0]).toMatchObject({ time: (NOW - 60_000) / 1000 });
    expect(store.getSnapshot().toasts).toEqual([]);
  });

  it("reports once and stops after the retries are spent", async () => {
    const { client, store } = setup();
    client.marks = async (market, resolution, fromMs, toMs) => {
      client.marksReads.push({ market, resolution, fromMs, toMs });
      throw new Error("The node did not answer.");
    };
    store.start(NOW);
    await settle();
    client.onMessage?.(tick(NOW + 60_000));
    await settle();
    client.onMessage?.(tick(NOW + 120_000));
    await settle();
    expect(client.marksReads).toHaveLength(3);
    const texts = store.getSnapshot().toasts.map((t) => t.text);
    expect(texts.filter((t) => t.startsWith("Chart history unavailable"))).toHaveLength(1);
    client.onMessage?.(tick(NOW + 180_000));
    await settle();
    expect(client.marksReads).toHaveLength(3);
  });

  it("keeps the provenance flag in the state: log_derived for log-derived marks, provider-seeded for seeded ones", async () => {
    const { client, store } = setup();
    client.marksPages = [{ entries: [entry(NOW - 60_000), entry(NOW - 30_000, "seeded_from_provider")], next: null }];
    store.start(NOW);
    await settle();
    expect(store.getSnapshot().barProvenance[1]?.["1m"]).toBe("seeded_from_provider");
    expect(store.getSnapshot().barProvenance[1]?.["5m"]).toBeUndefined();
  });

  it("seeds the bars a partial window kept when pages run past the budget", async () => {
    const { client, store } = setup();
    client.marks = async (market, resolution, fromMs, toMs) => {
      client.marksReads.push({ market, resolution, fromMs, toMs });
      return { entries: [entry(fromMs + 1)], next: fromMs + 1_000 < toMs ? fromMs + 1_000 : null };
    };
    store.start(NOW);
    await settle();
    // The budget cut the first pass; the halved pass re-read the newest span in four pages.
    expect(client.marksReads).toHaveLength(MARKS_PAGE_LIMIT + 4);
    expect(store.getSnapshot().bars[1]?.["1m"]).toEqual([
      { time: (NOW - 60_000) / 1000, open: 100_000, high: 100_000, low: 100_000, close: 100_000, observedHigh: 100_000, observedLow: 100_000 },
      streamBar(60),
    ]);
    expect(store.getSnapshot().barProvenance[1]?.["1m"]).toBe("log_derived");
  });

  it("asks the endpoint nothing for a client that checks no signatures", async () => {
    const { client, store } = setup({ initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: NOW } });
    client.signatures = "none";
    store.setTimeframe("1m");
    await settle();
    expect(client.marksReads).toHaveLength(0);
  });
});

describe("restarts", () => {
  it("discards an abandoned cycle's late answer, so the restarted store still retries the series", async () => {
    const { client, store } = setup();
    const gates: { resolve: (page: MarkPage) => void; reject: (error: Error) => void }[] = [];
    let calls = 0;
    client.marks = () => {
      calls++;
      return new Promise<MarkPage>((resolve, reject) => { gates.push({ resolve, reject }); });
    };
    store.start(NOW);
    await settle();
    store.start(NOW + 60_000); // the effect re-runs: the first fetch belongs to the abandoned cycle
    await store.refresh(false); // the markets read that follows a start
    await settle();
    expect(calls).toBe(2);
    gates[0]?.resolve({ entries: [], next: null }); // the abandoned cycle's late empty answer
    await settle();
    gates[1]?.reject(new Error("The node did not answer.")); // the current cycle's fetch fails
    await settle();
    client.onMessage?.(tick(NOW + 120_000)); // the series is unsealed, so the next trigger retries it
    await settle();
    expect(calls).toBe(3);
    expect(store.getSnapshot().toasts.filter((t) => t.text.startsWith("Chart history unavailable"))).toHaveLength(0);
  });
});

describe("the archive-scan fallback", () => {
  it("leaves the scan idle while the endpoint answers or fails short of a 404", async () => {
    const { client, store } = setup({ historyScan: scanBarsHistory });
    client.headSeq = 500_000; // a scan would start, if the fallback were asked
    client.marksPages = [{ entries: [entry(NOW - 60_000)], next: null }];
    store.start(NOW);
    await settle();
    store.setTimeframe("1h");
    await settle();
    expect(client.scans).toHaveLength(0);
    // A failure that is not a 404 retries the endpoint and never asks the scan.
    let calls = 0;
    client.marks = async (market, resolution, fromMs, toMs) => { client.marksReads.push({ market, resolution, fromMs, toMs }); calls++; throw new Error("The node did not answer."); };
    store.setTimeframe("5m");
    await settle();
    client.onMessage?.(tick(NOW + 60_000));
    await settle();
    expect(calls).toBe(2);
    expect(client.scans).toHaveLength(0);
    expect(store.getSnapshot().toasts.filter((t) => t.text.startsWith("Chart history unavailable"))).toHaveLength(0);
  });

  it("seeds every timeframe from the wired scan when the node 404s the endpoint", async () => {
    const { client, store } = setup({ historyScan: scanBarsHistory });
    client.headSeq = 500_000;
    client.scanned = [
      { market: 1, ts: NOW - 86_400_000, mid: 90 },
      { market: 1, ts: NOW - 3_600_000, mid: 95 },
      { market: 1, ts: NOW - 60_000, mid: 100 },
      { market: 1, ts: NOW, mid: 101 },
    ];
    client.marks = async () => { throw new EngineError(404, "not found"); };
    store.start(NOW);
    await settle();
    // The seam started the real scan, whose marks seeded the chart ahead of the stream's current bar.
    expect(client.scans).toHaveLength(1);
    expect(store.getSnapshot().bars[1]?.["1m"]?.slice(0, 4).map((bar) => bar.close)).toEqual([90, 95, 100, 101]);
    expect(store.getSnapshot().bars[1]?.["1h"]?.[0]?.close).toBe(90);
    store.setTimeframe("5m");
    await settle();
    expect(client.scans).toHaveLength(1);
  });

  it("runs the scan once when the node 404s the marks endpoint, and never asks the endpoint again", async () => {
    let asks = 0;
    const { client, store } = setup({ historyScan: () => { asks++; return true; } });
    client.marks = async () => { throw new EngineError(404, "not found"); };
    store.start(NOW);
    await settle();
    expect(asks).toBe(1);
    store.setTimeframe("1h");
    await settle();
    expect(asks).toBe(1);
    expect(store.getSnapshot().bars[1]?.["1m"]).toBeDefined();
  });

  it("asks again on the next read while the scan reports no log head yet", async () => {
    let asks = 0;
    const { client, store } = setup({ historyScan: () => { asks++; return asks >= 2; } });
    client.marks = async () => { throw new EngineError(404, "not found"); };
    store.start(NOW);
    await settle();
    expect(asks).toBe(1);
    client.onMessage?.(tick(NOW + 60_000));
    await settle();
    expect(asks).toBe(2);
    client.onMessage?.(tick(NOW + 120_000));
    await settle();
    expect(asks).toBe(2);
  });
});
