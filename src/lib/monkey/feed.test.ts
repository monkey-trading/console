import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { NO_STATS } from "../engine/live-stats";
import type { SeriesPage, SeriesQuery, StatsReads } from "../engine/stats-types";
import { ChartFeed, MAX_POINTS, mergePoints } from "./feed";

const on = () => true;
const point = (ms: number, value = ms) => ({ ms, value });

function page(query: SeriesQuery, entries: [number, string][], next: number | null = null): SeriesPage {
  return { metric: query.metric, market: null, resolution: query.resolution, kind: "flow", unit: "usdc_base_units", begins_ms: 100, begins_seq: 0, from_genesis: true, retained_from_ms: null, entries: entries.map(([ts, value]) => ({ ts, value })), next, max_limit: 2_000 };
}

/** Reads that answer from `pages` by the query's `fromMs`, recording each query. */
function reads(answer: (query: SeriesQuery) => SeriesPage | Error): { reads: StatsReads; queries: SeriesQuery[] } {
  const queries: SeriesQuery[] = [];
  return {
    queries,
    reads: { ...NO_STATS, series: async (query) => {
      queries.push(query);
      const result = answer(query);
      if (result instanceof Error) throw result;
      return result;
    } },
  };
}

describe("mergePoints", () => {
  it("replaces the bucket a later read saw again and appends what is newer", () => {
    expect(mergePoints([point(1), point(2, 20), point(3, 30)], [point(3, 31), point(4)])).toEqual([point(1), point(2, 20), point(3, 31), point(4)]);
  });
  it("drops buckets that start before the floor, from both what is held and what is new", () => {
    expect(mergePoints([point(1), point(2), point(3)], [point(3, 31), point(4)], 3)).toEqual([point(3, 31), point(4)]);
    expect(mergePoints([point(1), point(2)], [], 2)).toEqual([point(2)]);
  });
  it("keeps what it holds when nothing is new", () => {
    expect(mergePoints([point(1)], [])).toEqual([point(1)]);
  });
  it("holds only the newest points", () => {
    const held = Array.from({ length: MAX_POINTS }, (_, i) => point(i));
    const merged = mergePoints(held, [point(MAX_POINTS), point(MAX_POINTS + 1)]);
    expect(merged).toHaveLength(MAX_POINTS);
    expect(merged[0]?.ms).toBe(2);
    expect(merged.at(-1)?.ms).toBe(MAX_POINTS + 1);
  });
});

describe("ChartFeed", () => {
  const now = () => 10 * 86_400_000;

  it("reads the window for its timeframe, follows the pages, and keeps the exact latest text", async () => {
    const { reads: client, queries } = reads((query) => (query.fromMs === now() - 7 * 86_400_000 ? page(query, [[1_000, "5000000"]], 2_000) : page(query, [[2_000, "7000000"]])));
    const feed = new ChartFeed(["distributed_per_epoch"], client, now, on, "7d");
    await feed.load();
    expect(queries.map((q) => [q.resolution, q.fromMs])).toEqual([["1h", now() - 7 * 86_400_000], ["1h", 2_000]]);
    const data = feed.getSnapshot().read.value;
    expect(data?.lines["distributed_per_epoch"]).toEqual([point(1_000, 5), point(2_000, 7)]);
    expect(data?.latest["distributed_per_epoch"]).toBe("7000000");
    expect(data?.begins_ms).toBe(100);
  });

  it("reads from the start of the record for All", async () => {
    const { reads: client, queries } = reads((query) => page(query, []));
    await new ChartFeed(["distributed_per_epoch"], client, now, on, "all").load();
    expect(queries[0]).toMatchObject({ resolution: "1d", fromMs: 0 });
  });

  it("shows a node without the route as unavailable, not failed", async () => {
    const feed = new ChartFeed(["total_staked"], NO_STATS, now, on, "all");
    await feed.load();
    expect(feed.getSnapshot().read.status).toBe("unavailable");
  });

  it("keeps the last answer when a later read fails", async () => {
    let fail = false;
    const { reads: client } = reads((query) => (fail ? new EngineError(500, "boom") : page(query, [[1_000, "1000000"]])));
    const feed = new ChartFeed(["distributed_per_epoch"], client, now, on, "7d");
    await feed.load();
    fail = true;
    await feed.load();
    expect(feed.getSnapshot().read).toMatchObject({ status: "failed", message: "boom" });
    expect(feed.getSnapshot().read.value?.lines["distributed_per_epoch"]).toHaveLength(1);
  });

  it("refreshes only while Live is on, from the last bucket, and replaces the open one", async () => {
    const open = now() - 3_600_000;
    const next = now() - 1_800_000;
    let live = false;
    const { reads: client, queries } = reads((query) => (live ? page(query, [[open, "2000000"], [next, "3000000"]]) : page(query, [[open, "1000000"]])));
    const feed = new ChartFeed(["distributed_per_epoch"], client, now, on, "7d");
    await feed.load();
    await feed.tickLive();
    expect(queries).toHaveLength(1);
    feed.setLive(true);
    live = true;
    await feed.tickLive();
    expect(queries[1]).toMatchObject({ fromMs: open, limit: 50 });
    expect(feed.getSnapshot().read.value?.lines["distributed_per_epoch"]).toEqual([point(open, 2), point(next, 3)]);
  });

  it("drops a read that a newer one has overtaken", async () => {
    const releases: (() => void)[] = [];
    const client: StatsReads = { ...NO_STATS, series: (query) => new Promise((resolve) => releases.push(() => resolve(page(query, [[1_000, String(query.resolution === "1m" ? 1_000_000 : 9_000_000)]])))) };
    const feed = new ChartFeed(["distributed_per_epoch"], client, now, on, "6h");
    const first = feed.load();
    const second = feed.setTimeframe("7d");
    releases[1]?.();
    await Promise.resolve();
    releases[0]?.();
    await first;
    await second;
    expect(feed.getSnapshot().read.value?.lines["distributed_per_epoch"]).toEqual([point(1_000, 9)]);
    expect(feed.getSnapshot().read.value?.timeframe).toBe("7d");
  });

  it("keeps a live window to its timeframe as the clock moves", async () => {
    let clock = 10 * 86_400_000;
    const hour = 3_600_000;
    const fresh = clock - hour;
    const { reads: client } = reads((query) => (query.limit === 50 ? page(query, [[fresh, "2000000"]]) : page(query, [[clock - 7 * 86_400_000, "1000000"], [fresh, "1000000"]])));
    const feed = new ChartFeed(["distributed_per_epoch"], client, () => clock, on, "7d");
    await feed.load();
    feed.setLive(true);
    clock += 2 * hour;
    await feed.tickLive();
    const ms = feed.getSnapshot().read.value?.lines["distributed_per_epoch"]?.map((p) => p.ms) ?? [];
    // The 7-day-old bucket is gone; the one the live read returned stays.
    expect(ms).toEqual([fresh]);
  });

  it("reads the whole window again, not a live slice, when the held points belong to another timeframe", async () => {
    let failing = false;
    const { reads: client, queries } = reads((query) => (failing ? new EngineError(503, "busy") : page(query, [[1_000, "1000000"]])));
    const feed = new ChartFeed(["distributed_per_epoch"], client, now, on, "all");
    await feed.load();
    feed.setLive(true);
    failing = true;
    await feed.setTimeframe("6h");
    expect(feed.getSnapshot().read).toMatchObject({ status: "failed" });
    expect(feed.getSnapshot().read.value?.timeframe).toBe("all");
    failing = false;
    queries.length = 0;
    await feed.tickLive();
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ resolution: "1m", limit: 1_000 });
    expect(feed.getSnapshot().read).toMatchObject({ status: "ready" });
    expect(feed.getSnapshot().read.value?.timeframe).toBe("6h");
  });

  it("reads nothing while its page is not reading, and forgets what it held when it closes", async () => {
    let reading = false;
    const { reads: client, queries } = reads((query) => page(query, [[1_000, "1000000"]]));
    const feed = new ChartFeed(["distributed_per_epoch"], client, now, () => reading, "7d");
    await feed.load();
    expect(queries).toEqual([]);
    reading = true;
    await feed.load();
    expect(feed.getSnapshot().read.value).not.toBeNull();
    feed.close();
    expect(feed.getSnapshot().read).toEqual({ status: "loading", value: null, message: null });
  });

  it("starts a live read at the window, not the record's start, for a line with no buckets in it", async () => {
    const day = 86_400_000;
    const { reads: client, queries } = reads((query) => (query.limit === 50 ? page(query, [[now() - 2 * day, "9000000"], [now() - 3_600_000, "4000000"]]) : page(query, [])));
    const feed = new ChartFeed(["distributed_per_epoch"], client, now, on, "7d");
    await feed.load();
    feed.setLive(true);
    await feed.tickLive();
    expect(queries[1]).toMatchObject({ limit: 50, fromMs: now() - 7 * day - 3_600_000 });
    // Only a bucket inside the window is the latest; the older one the page also held is not.
    expect(feed.getSnapshot().read.value?.latest["distributed_per_epoch"]).toBe("4000000");
  });

  it("tries a first read that failed again on the next live tick, and leaves a node without the route alone", async () => {
    let failure: Error | null = new EngineError(503, "busy");
    const { reads: client, queries } = reads((query) => failure ?? page(query, [[now() - 3_600_000, "1000000"]]));
    const feed = new ChartFeed(["distributed_per_epoch"], client, now, on, "7d");
    await feed.load();
    feed.setLive(true);
    failure = null;
    await feed.tickLive();
    expect(queries).toHaveLength(2);
    expect(feed.getSnapshot().read.status).toBe("ready");
    const missing = new ChartFeed(["distributed_per_epoch"], NO_STATS, now, on, "7d");
    await missing.load();
    missing.setLive(true);
    await missing.tickLive();
    expect(missing.getSnapshot().read.status).toBe("unavailable");
  });

  it("stops paging a window once the chart has been closed or moved on", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const client: StatsReads = { ...NO_STATS, series: async (query) => {
      calls += 1;
      if (calls === 1) await gate;
      return page(query, [[calls * 1_000, "1000000"]], calls * 1_000 + 1);
    } };
    const feed = new ChartFeed(["distributed_per_epoch"], client, now, on, "7d");
    const loading = feed.load();
    await Promise.resolve();
    feed.close();
    release();
    await loading;
    // The first page was asked for; the page it pointed to was not, since nothing is reading.
    expect(calls).toBe(1);
  });

  it("keeps the chart as it was when a live refresh fails, and says so beside it", async () => {
    let failing = false;
    const at = now() - 3_600_000;
    const { reads: client } = reads((query) => (failing ? new EngineError(503, "busy") : page(query, [[at, "1000000"]])));
    const feed = new ChartFeed(["distributed_per_epoch"], client, now, on, "7d");
    await feed.load();
    feed.setLive(true);
    failing = true;
    await feed.tickLive();
    expect(feed.getSnapshot().read).toMatchObject({ status: "ready", message: "busy" });
    expect(feed.getSnapshot().read.value?.lines["distributed_per_epoch"]).toEqual([point(at, 1)]);
  });

  it("clears the latest value when its last bucket ages out of a live window and nothing replaces it", async () => {
    const hour = 3_600_000;
    let clock = 10 * 86_400_000;
    const at = clock - 5 * hour;
    const { reads: client } = reads((query) => (query.limit === 50 ? page(query, []) : page(query, [[at, "1000000"]])));
    const feed = new ChartFeed(["distributed_per_epoch"], client, () => clock, on, "6h");
    await feed.load();
    expect(feed.getSnapshot().read.value?.latest["distributed_per_epoch"]).toBe("1000000");
    feed.setLive(true);
    clock += 2 * hour;
    await feed.tickLive();
    expect(feed.getSnapshot().read.value?.lines["distributed_per_epoch"]).toEqual([]);
    expect(feed.getSnapshot().read.value?.latest["distributed_per_epoch"]).toBeNull();
  });

  it("stands down after close", async () => {
    const { reads: client } = reads((query) => page(query, [[1_000, "1000000"]]));
    const feed = new ChartFeed(["distributed_per_epoch"], client, now, on, "7d");
    const loading = feed.load();
    feed.close();
    await loading;
    expect(feed.getSnapshot().read.status).toBe("loading");
  });
});
