/** Tests for seeding the chart's bars from the node's marks endpoint, and its archive-scan fallback. */

import { describe, expect, it } from "vitest";

import { barsFromMarks } from "../bars";
import { EngineError } from "../engine/client";
import { MARKS_PAGE_LIMIT } from "../engine/marks-fetch";
import { settle } from "../engine/test-kit";
import type { MarkProvenance, StreamMessage } from "../engine/types";
import { BTC, setup } from "./live-fake";

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const entry = (tMs: number, provenance: MarkProvenance = "log_derived") => ({ t_ms: tMs, mid: "100000", provenance });
const tick = (ts: number): StreamMessage => ({ offset: "1:0", type: "command", seq: 1, ts, cmd: { type: "tick" } as StreamMessage["cmd"], events: [] });

describe("seeding the chart from the marks endpoint", () => {
  it("replaces the selected market's active timeframe after the first live read, leaving the other series stream-built", async () => {
    const { client, store } = setup();
    client.marksPages = [{ entries: [entry(NOW - 60_000), entry(NOW - 30_000), entry(NOW - 5_000)], next_from_ms: null }];
    store.start(NOW);
    await settle();
    const bars1m = store.getSnapshot().bars[1]?.["1m"] ?? [];
    const bars5m = store.getSnapshot().bars[1]?.["5m"] ?? [];
    const marks = [{ ts: NOW - 60_000, mid: 100_000 }, { ts: NOW - 30_000, mid: 100_000 }, { ts: NOW - 5_000, mid: 100_000 }];
    expect(bars1m).toEqual(barsFromMarks(marks, 60));
    // The 5m series is the one the stream's tick built at the current mark, not the endpoint's.
    expect(bars5m).toEqual([{ time: Math.floor(NOW / 1000 / 300) * 300, open: 100_000, high: 100_000, low: 100_000, close: 100_000 }]);
    expect(client.marksReads).toHaveLength(1);
    expect(client.marksReads[0]).toMatchObject({ market: 1, resolution: "1s", toMs: NOW });
  });

  it("fetches the new timeframe's resolution on a switch, and seeds each series once", async () => {
    const { client, store } = setup();
    client.marksPages = [
      { entries: [entry(NOW - 60_000)], next_from_ms: null },
      { entries: [entry(NOW - 3_600_000), entry(NOW - 5_000)], next_from_ms: null },
    ];
    store.start(NOW);
    await settle();
    expect(client.marksReads).toHaveLength(1);
    store.setTimeframe("1h");
    await settle();
    expect(client.marksReads).toHaveLength(2);
    expect(client.marksReads[1]).toMatchObject({ resolution: "1h" });
    expect(store.getSnapshot().bars[1]?.["1h"]).toEqual(barsFromMarks([{ ts: NOW - 3_600_000, mid: 100_000 }, { ts: NOW - 5_000, mid: 100_000 }], 3_600));
    store.setTimeframe("1m");
    await settle();
    expect(client.marksReads).toHaveLength(2);
  });

  it("keeps the provenance flag in the state: log_derived for log-derived marks, provider-seeded for seeded ones", async () => {
    const { client, store } = setup();
    client.marksPages = [{ entries: [entry(NOW - 60_000), entry(NOW - 30_000, "seeded_from_provider")], next_from_ms: null }];
    store.start(NOW);
    await settle();
    expect(store.getSnapshot().barProvenance[1]?.["1m"]).toBe("seeded_from_provider");
    expect(store.getSnapshot().barProvenance[1]?.["5m"]).toBeUndefined();
  });

  it("seeds the bars a partial window kept when pages run past the budget", async () => {
    const { client, store } = setup();
    client.marks = async (market, resolution, fromMs, toMs) => {
      client.marksReads.push({ market, resolution, fromMs, toMs });
      return { entries: [entry(fromMs + 1)], next_from_ms: fromMs + 1_000 < toMs ? fromMs + 1_000 : null };
    };
    store.start(NOW);
    await settle();
    expect(client.marksReads).toHaveLength(MARKS_PAGE_LIMIT);
    expect(store.getSnapshot().bars[1]?.["1m"]).toHaveLength(1);
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

describe("the archive-scan fallback", () => {
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
