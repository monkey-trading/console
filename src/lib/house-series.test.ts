import { describe, expect, it } from "vitest";

import type { SeriesPage } from "./engine/stats-types";
import { beginsOf, beginsText, foldSeries, FOLLOW_UP_LIMIT, MAX_POINTS, nextQuery, pointsOf, tableRows, rangeOf, seriesQuery } from "./house-series";

const level = (ts: number, close: string) => ({ ts, open: close, high: close, low: close, close });
const page = (entries: SeriesPage["entries"], extra: Partial<SeriesPage> = {}): SeriesPage => ({
  metric: "nav", market: null, resolution: "1m", kind: "level", unit: "usd", begins_ms: 1_000, begins_seq: 0, from_genesis: true, retained_from_ms: null, entries, next: null, max_limit: 2000, ...extra,
});

describe("seriesQuery", () => {
  it("aligns the window to the bucket and asks for one page that holds it", () => {
    const q = seriesQuery("nav", null, "1h", 7_200_123);
    expect(q).toEqual({ metric: "nav", market: null, resolution: "1m", fromMs: 3_600_000, toMs: 7_200_123, limit: 62 });
  });

  it("reads a month at hourly buckets and a year at daily ones, never past the node's page cap", () => {
    expect(seriesQuery("long", 2, "30d", 40 * 86_400_000)).toMatchObject({ resolution: "1h", market: 2, limit: 722 });
    expect(seriesQuery("nav", null, "1y", 400 * 86_400_000)).toMatchObject({ resolution: "1d", limit: 367 });
    for (const r of ["1h", "6h", "1d", "7d", "30d", "1y"] as const) expect(seriesQuery("nav", null, r, 1e12).limit).toBeLessThanOrEqual(MAX_POINTS);
  });

  it("refuses an unknown range", () => {
    expect(() => rangeOf("2y" as never)).toThrow("unknown range");
  });
});

describe("pointsOf", () => {
  it("plots a level's close and a flow's value", () => {
    expect(pointsOf([level(1, "10.5"), { ts: 2, value: "3" }])).toEqual([{ ts: 1, value: 10.5 }, { ts: 2, value: 3 }]);
  });

  it("refuses an entry whose amount is not a decimal instead of plotting a guess", () => {
    expect(() => pointsOf([level(1, "x"), level(2, "4")])).toThrow("malformed decimal");
  });
});

describe("foldSeries", () => {
  it("replaces the last bucket held and appends newer ones on a follow-up read", () => {
    const first = foldSeries(null, page([level(60, "1"), level(120, "2")]), 0);
    const next = foldSeries(first, page([level(120, "5"), level(180, "6")]), 0);
    expect(next.points).toEqual([{ ts: 60, value: 1 }, { ts: 120, value: 5 }, { ts: 180, value: 6 }]);
  });

  it("drops buckets before the window, so a long-open page does not hold history it no longer shows", () => {
    const folded = foldSeries(null, page([level(60, "1"), level(120, "2"), level(180, "3")]), 100);
    expect(folded.points.map((p) => p.ts)).toEqual([120, 180]);
  });

  it("holds at most the page cap of points", () => {
    const entries = Array.from({ length: MAX_POINTS + 50 }, (_, i) => level(i * 60, "1"));
    expect(foldSeries(null, page(entries), 0).points).toHaveLength(MAX_POINTS);
  });

  it("keeps what the node says about where its data begins", () => {
    const folded = foldSeries(null, page([], { begins_ms: 5, from_genesis: false, retained_from_ms: 9 }), 0);
    expect(folded).toMatchObject({ beginsMs: 5, fromGenesis: false, retainedFromMs: 9 });
  });
});

describe("where a chart's data begins", () => {
  const data = (extra: Partial<Parameters<typeof foldSeries>[1]>) => foldSeries(null, page([], extra), 0);
  const stamp = (ms: number) => `t${ms}`;

  it("is the record's start from genesis, and says so", () => {
    expect(beginsOf(data({ begins_ms: 5 }))).toEqual({ ms: 5, reason: "genesis" });
    expect(beginsText(data({ begins_ms: 5 }), stamp)).toBe("Data begins t5 UTC, from the log's first command.");
  });

  it("says the history after a snapshot recovery is partial", () => {
    expect(beginsText(data({ begins_ms: 5, from_genesis: false }), stamp)).toContain("since the node last recovered from a snapshot");
  });

  it("is the retention edge when the node has pruned past the record's start, never claimed as the first command", () => {
    expect(beginsOf(data({ begins_ms: 5, retained_from_ms: 9 }))).toEqual({ ms: 9, reason: "retention" });
    expect(beginsText(data({ begins_ms: 5, retained_from_ms: 9 }), stamp)).toBe("Data begins t9 UTC, the oldest this node keeps at this resolution.");
    expect(beginsOf(data({ begins_ms: 9, retained_from_ms: 5 }))?.reason).toBe("genesis");
  });

  it("says nothing was recorded when the node names no beginning", () => {
    expect(beginsText(data({ begins_ms: null }), stamp)).toBe("The node has recorded nothing for this chart yet.");
    expect(beginsText(null, stamp)).toBe("The node has recorded nothing for this chart yet.");
  });
});

describe("nextQuery", () => {
  const full = seriesQuery("nav", null, "1d", 10 * 86_400_000);
  const held = (ts: number) => foldSeries(null, page([level(ts, "1")]), 0);

  it("reads the whole window the first time", () => {
    expect(nextQuery(full, null)).toBe(full);
  });

  it("reads from the last bucket held when one page reaches the present", () => {
    const last = full.toMs - 5 * 60_000;
    expect(nextQuery(full, held(last))).toEqual({ ...full, fromMs: last, limit: FOLLOW_UP_LIMIT });
  });

  it("reads the whole window again after a gap one follow-up page could not cover", () => {
    expect(nextQuery(full, held(full.toMs - FOLLOW_UP_LIMIT * 60_000))).toBe(full);
    expect(nextQuery(full, held(full.toMs - (FOLLOW_UP_LIMIT - 3) * 60_000))).not.toBe(full);
  });
});

describe("tableRows", () => {
  const points = (...values: [number, number][]) => values.map(([ts, value]) => ({ ts, value }));

  it("lists the newest buckets first, each series' value under its own bucket time", () => {
    const long = points([60, 1], [120, 2], [180, 3]);
    const short = points([60, 10], [120, 20], [240, 40]);
    expect(tableRows([long, short], 10)).toEqual([
      { ts: 240, values: [null, 40] },
      { ts: 180, values: [3, null] },
      { ts: 120, values: [2, 20] },
      { ts: 60, values: [1, 10] },
    ]);
  });

  it("keeps the newest rows when there are more than the limit", () => {
    expect(tableRows([points([1, 1], [2, 2], [3, 3])], 2).map((row) => row.ts)).toEqual([3, 2]);
  });

  it("is empty for no series", () => {
    expect(tableRows([], 5)).toEqual([]);
  });
});
