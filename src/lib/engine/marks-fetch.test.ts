/** Tests for the marks endpoint's window fetch: timeframe mapping, pagination, budget, and provenance. */

import { describe, expect, it } from "vitest";

import { FakeClient } from "../store/live-fake";
import type { MarkEntry, MarkProvenance } from "./mark-types";
import { fetchBarsHistory, MARKS_PAGE_LIMIT, resolutionFor, windowSecondsFor } from "./marks-fetch";

const entry = (tMs: number, provenance: MarkProvenance = "log_derived"): MarkEntry => ({ t_ms: tMs, mid: "100", provenance });

describe("resolutionFor", () => {
  it("maps each timeframe to the resolution that fills its chart window", () => {
    expect(resolutionFor("1m")).toBe("1s");
    expect(resolutionFor("5m")).toBe("1m");
    expect(resolutionFor("15m")).toBe("1m");
    expect(resolutionFor("1h")).toBe("1h");
    expect(resolutionFor("1D")).toBe("1d");
  });
});

describe("windowSecondsFor", () => {
  it("covers the most bars the chart keeps, at each timeframe's size", () => {
    expect(windowSecondsFor("1m")).toBe(60 * 500);
    expect(windowSecondsFor("5m")).toBe(300 * 500);
    expect(windowSecondsFor("1D")).toBe(86_400 * 500);
  });
});

describe("fetchBarsHistory", () => {
  it("fetches one page for the market, resolution, and window, and folds it into bars", async () => {
    const client = new FakeClient();
    client.marksPages = [{ entries: [entry(60_000), entry(61_000), entry(62_000), entry(120_000)], next_from_ms: null }];
    const got = await fetchBarsHistory(client, 1, "1m", 0, 120_000);
    expect(client.marksReads).toEqual([{ market: 1, resolution: "1s", fromMs: 0, toMs: 120_000 }]);
    expect(got.complete).toBe(true);
    expect(got.bars).toEqual([
      { time: 60, open: 100, high: 100, low: 100, close: 100, observedHigh: 100, observedLow: 100 },
      { time: 120, open: 100, high: 100, low: 100, close: 100, observedHigh: 100, observedLow: 100 },
    ]);
  });

  it("follows next_from_ms, asking each page from the last page's cursor, until a page names none", async () => {
    const client = new FakeClient();
    client.marksPages = [
      { entries: [entry(10), entry(20)], next_from_ms: 30 },
      { entries: [entry(30)], next_from_ms: null },
    ];
    const got = await fetchBarsHistory(client, 1, "1m", 0, 100);
    expect(client.marksReads.map((read) => read.fromMs)).toEqual([0, 30]);
    expect(got.complete).toBe(true);
    expect(got.bars).toHaveLength(1);
  });

  it("halves toward the recent edge when the budget cuts a pass, so the kept bars reach to_ms", async () => {
    class PagingClient extends FakeClient {
      override async marks(market: number, resolution: "1s" | "1m" | "1h" | "1d", fromMs: number, toMs: number) {
        this.marksReads.push({ market, resolution, fromMs, toMs });
        // The window takes one page more than the budget allows.
        return { entries: [entry(fromMs + 1)], next_from_ms: fromMs + 1_000 < toMs ? fromMs + 1_000 : null };
      }
    }
    const client = new PagingClient();
    const toMs = (MARKS_PAGE_LIMIT + 1) * 1_000;
    const got = await fetchBarsHistory(client, 1, "1m", 0, toMs);
    // The budget cut the first pass one page short; the next pass reads the newest half of its span and completes.
    expect(client.marksReads.map((read) => read.fromMs)).toEqual([0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 5_000, 6_000, 7_000, 8_000]);
    expect(got.complete).toBe(true);
    expect(got.bars).toHaveLength(1);
  });

  it("keeps halving, bounded by the pass cap, when a window is denser near its recent edge", async () => {
    class DenseTailClient extends FakeClient {
      override async marks(market: number, resolution: "1s" | "1m" | "1h" | "1d", fromMs: number, toMs: number) {
        this.marksReads.push({ market, resolution, fromMs, toMs });
        // Every mark sits inside the requested window; the recent edge is denser.
        const step = fromMs >= 8_000 ? 50 : 1_000;
        return { entries: [entry(fromMs + 1)], next_from_ms: fromMs + step < toMs ? fromMs + step : null };
      }
    }
    const client = new DenseTailClient();
    const got = await fetchBarsHistory(client, 1, "1m", 0, 10_000);
    expect(client.marksReads.map((read) => read.fromMs)).toEqual([
      0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000,
      6_000, 7_000, 8_000, 8_050, 8_100, 8_150, 8_200, 8_250,
      8_850, 8_900, 8_950, 9_000, 9_050, 9_100, 9_150, 9_200,
    ]);
    expect(got.complete).toBe(false);
    expect(got.bars).toHaveLength(1);
  });

  it("keeps the last span read when a narrowed pass finds the window empty, as in a closure", async () => {
    const client = new FakeClient();
    client.marksPages = [
      ...Array.from({ length: MARKS_PAGE_LIMIT }, (_, i) => ({ entries: [entry(i * 1_000)], next_from_ms: (i + 1) * 1_000 })),
      { entries: [], next_from_ms: null },
    ];
    const got = await fetchBarsHistory(client, 1, "1m", 0, (MARKS_PAGE_LIMIT + 1) * 1_000);
    // The first pass spent its budget on the window's history; the narrowed pass read the closure at its recent edge.
    expect(client.marksReads).toHaveLength(MARKS_PAGE_LIMIT + 1);
    expect(got.complete).toBe(false);
    expect(got.bars).toHaveLength(1);
  });

  it("stops when a page names a next page without entries, instead of paging forever", async () => {
    const client = new FakeClient();
    client.marksPages = [
      { entries: [entry(5)], next_from_ms: 50 },
      { entries: [], next_from_ms: 60 },
    ];
    const got = await fetchBarsHistory(client, 1, "1m", 0, 100);
    expect(client.marksReads).toHaveLength(2);
    expect(got.complete).toBe(false);
  });

  it("reports log_derived when every fetched entry says so", async () => {
    const client = new FakeClient();
    client.marksPages = [{ entries: [entry(5), entry(6)], next_from_ms: null }];
    const got = await fetchBarsHistory(client, 1, "1m", 0, 100);
    expect(got.provenance).toBe("log_derived");
  });

  it("reports seeded_from_provider when any fetched entry is provider-seeded, in either page order", async () => {
    const client = new FakeClient();
    client.marksPages = [
      { entries: [entry(5, "log_derived")], next_from_ms: 10 },
      { entries: [entry(10, "seeded_from_provider")], next_from_ms: null },
    ];
    const forward = await fetchBarsHistory(client, 1, "1m", 0, 100);
    expect(forward.provenance).toBe("seeded_from_provider");
    const back = new FakeClient();
    back.marksPages = [
      { entries: [entry(5, "seeded_from_provider")], next_from_ms: 10 },
      { entries: [entry(10, "log_derived")], next_from_ms: null },
    ];
    const backward = await fetchBarsHistory(back, 1, "1m", 0, 100);
    expect(backward.provenance).toBe("seeded_from_provider");
  });

  it("names no provenance for an empty window", async () => {
    const client = new FakeClient();
    const got = await fetchBarsHistory(client, 1, "1m", 0, 100);
    expect(got.provenance).toBeNull();
    expect(got.bars).toEqual([]);
  });
});
