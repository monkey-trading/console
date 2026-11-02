/** Tests for the House page's dashboard feeds: they read only while the page is open, at a bounded pace, and say calmly what the node cannot serve. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineError } from "../engine/client";
import type { PositionsView, SeriesPage } from "../engine/stats-types";
import { candlesFeed, positionsFeed, seriesFeed } from "./house-feeds";
import { MIN_EVERY_MS, type FeedSpec } from "./house-stats";
import { setup } from "./live-fake";

const NOW = 1_800_000_000_000;
const POSITIONS = { market: 1, symbol: "BTC-USD" } as unknown as PositionsView;
const page = (entries: SeriesPage["entries"]): SeriesPage => ({
  metric: "nav", market: null, resolution: "1m", kind: "level", unit: "usd", begins_ms: NOW - 600_000, begins_seq: 0, from_genesis: true, retained_from_ms: null, entries, next: null, max_limit: 2000,
});
const level = (ts: number, close: string) => ({ ts, open: close, high: close, low: close, close });
const spec = (key: string, everyMs: number, reads: string[]): FeedSpec<number> => ({ key, everyMs, read: async () => { reads.push(key); return reads.length; } });

describe("the House page's dashboard feeds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("reads nothing until the page opens, then reads at once, and nothing after it closes", async () => {
    const { store } = setup();
    const reads: string[] = [];
    const release = store.houseStats.follow(spec("a", 30_000, reads));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(reads).toEqual([]);
    store.houseStats.setOpen(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads).toEqual(["a", "a"]);
    store.houseStats.setOpen(false);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(reads).toHaveLength(2);
    release();
  });

  it("never reads one feed faster than the floor, whatever a panel asks for", async () => {
    const { store } = setup();
    const reads: string[] = [];
    store.houseStats.setOpen(true);
    store.houseStats.follow(spec("fast", 100, reads));
    await vi.advanceTimersByTimeAsync(MIN_EVERY_MS * 3 + 10);
    expect(reads).toHaveLength(4);
  });

  it("stops reading a feed when its last follower leaves, and shares one read between followers", async () => {
    const { store } = setup();
    const reads: string[] = [];
    store.houseStats.setOpen(true);
    const first = store.houseStats.follow(spec("shared", 10_000, reads));
    const second = store.houseStats.follow(spec("shared", 10_000, reads));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads).toHaveLength(2);
    first();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads).toHaveLength(3);
    second();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads).toHaveLength(3);
  });

  it("shows a route the node does not serve as unavailable and asks again only after minutes, with no toast", async () => {
    const { client, store } = setup();
    store.houseStats.setOpen(true);
    const spec404 = positionsFeed(store, 1);
    store.houseStats.follow(spec404);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.houseStats.state(spec404.key)).toMatchObject({ status: "unavailable", data: null });
    await vi.advanceTimersByTimeAsync(240_000);
    expect(client.statsReads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.statsReads).toHaveLength(2);
    expect(store.getSnapshot().toasts).toEqual([]);
  });

  it("waits for the node's first scan on a 503 and then shows the positions", async () => {
    const { client, store } = setup();
    client.statsError = new EngineError(503, "no position snapshot yet");
    store.houseStats.setOpen(true);
    const feed = positionsFeed(store, 1);
    store.houseStats.follow(feed);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.houseStats.state(feed.key).status).toBe("waiting");
    client.statsError = null;
    client.positionsView = POSITIONS;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.houseStats.state(feed.key)).toMatchObject({ status: "ready", data: POSITIONS, stale: false });
  });

  it("keeps the last data through a failed read, marked stale with the reason, and backs off", async () => {
    const { client, store } = setup();
    client.positionsView = POSITIONS;
    store.houseStats.setOpen(true);
    const feed = positionsFeed(store, 1);
    store.houseStats.follow(feed);
    await vi.advanceTimersByTimeAsync(0);
    client.statsError = new Error("the node stalled");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(store.houseStats.state(feed.key)).toMatchObject({ status: "ready", data: POSITIONS, stale: true, error: "the node stalled" });
    const reads = client.statsReads.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.statsReads).toHaveLength(reads);
  });

  it("reads a series' whole window first and then only from its last bucket", async () => {
    const { client, store } = setup();
    store.patch({ now: NOW });
    client.seriesPage = page([level(NOW - 120_000, "10"), level(NOW - 60_000, "11")]);
    store.houseStats.setOpen(true);
    const feed = seriesFeed(store, "nav", null, "1h", true);
    store.houseStats.follow(feed);
    await vi.advanceTimersByTimeAsync(0);
    client.seriesPage = page([level(NOW - 60_000, "12"), level(NOW, "13")]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.statsReads).toEqual([`series:nav:${NOW - 3_600_000}:62`, `series:nav:${NOW - 60_000}:200`]);
    const data = store.houseStats.state<{ points: { ts: number; value: number }[] }>(feed.key).data;
    expect(data?.points.map((p) => p.value)).toEqual([10, 12, 13]);
  });

  it("drops the oldest unfollowed feeds beyond a handful, so what is held stays bounded", async () => {
    const { store } = setup();
    const reads: string[] = [];
    store.houseStats.setOpen(true);
    for (let i = 0; i < 12; i++) {
      const release = store.houseStats.follow(spec(`k${i}`, 30_000, reads));
      await vi.advanceTimersByTimeAsync(0);
      release();
    }
    const held = Array.from({ length: 12 }, (_, i) => store.houseStats.state(`k${i}`).status).filter((status) => status === "ready");
    expect(held).toHaveLength(6);
    expect(store.houseStats.state("k0").status).toBe("loading");
    expect(store.houseStats.state("k11").status).toBe("ready");
  });

  it("pauses every feed while the tab is hidden and reads again, at its own pace, when it shows", async () => {
    const { store } = setup();
    const reads: string[] = [];
    store.houseStats.setOpen(true);
    store.houseStats.follow(spec("a", 30_000, reads));
    await vi.advanceTimersByTimeAsync(0);
    store.houseStats.setVisible(false);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(reads).toHaveLength(1);
    store.houseStats.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toHaveLength(2);
  });

  it("keeps an answer that lands as the page closes, and tells a read to stop asking once nobody follows the feed", async () => {
    const { store } = setup();
    let release: (value: number) => void = () => {};
    const alive: boolean[] = [];
    const unfollow = store.houseStats.follow({
      key: "slow", everyMs: 30_000,
      read: (_previous, stillWanted) => new Promise<number>((resolve) => { release = (value) => { alive.push(stillWanted()); resolve(value); }; }),
    });
    store.houseStats.setOpen(true);
    await vi.advanceTimersByTimeAsync(0);
    unfollow();
    store.houseStats.setOpen(false);
    release(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(alive).toEqual([false]);
    expect(store.houseStats.state("slow")).toMatchObject({ status: "ready", data: 7 });
  });

  it("says a feed whose first read fails has failed, and keeps its data through a later 404 or 503", async () => {
    const { client, store } = setup();
    client.statsError = new Error("the node stalled");
    store.houseStats.setOpen(true);
    const feed = positionsFeed(store, 1);
    store.houseStats.follow(feed);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.houseStats.state(feed.key)).toEqual({ status: "failed", data: null, stale: false, error: "the node stalled" });
    client.statsError = null;
    client.positionsView = POSITIONS;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.houseStats.state(feed.key).status).toBe("ready");
    client.statsError = new EngineError(503, "no position snapshot yet");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(store.houseStats.state(feed.key)).toEqual({ status: "waiting", data: POSITIONS, stale: true, error: null });
    client.statsError = new EngineError(404, "not found");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.houseStats.state(feed.key)).toEqual({ status: "unavailable", data: POSITIONS, stale: true, error: null });
  });

  it("keeps the wait a 404 chose when the feed is followed again or the tab shows again", async () => {
    const { client, store } = setup();
    store.houseStats.setOpen(true);
    const feed = positionsFeed(store, 1);
    store.houseStats.follow(feed);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.statsReads).toHaveLength(1);
    store.houseStats.follow(feed)();
    store.houseStats.setVisible(false);
    await vi.advanceTimersByTimeAsync(60_000);
    store.houseStats.setVisible(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.statsReads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(130_000);
    expect(client.statsReads).toHaveLength(2);
  });

  it("applies a change of pace made while a read is in flight to the read that follows it", async () => {
    const { store } = setup();
    store.houseStats.setOpen(true);
    const reads: number[] = [];
    let finish: () => void = () => {};
    const slow = (everyMs: number): FeedSpec<number> => ({ key: "pace", everyMs, read: () => new Promise<number>((resolve) => { reads.push(Date.now()); finish = () => resolve(1); }) });
    const calm = store.houseStats.follow(slow(30_000));
    await vi.advanceTimersByTimeAsync(0);
    calm();
    store.houseStats.follow(slow(5_000));
    finish();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reads).toHaveLength(2);
  });

  it("reads a market's candles over the node's time window and hands the read its liveness", async () => {
    const { client, store } = setup();
    store.patch({ now: NOW });
    client.marksPages = [{ entries: [{ ts: NOW - 60_000, open: "1", high: "1", low: "1", close: "1", provenance: "log_derived" }], next: null }];
    const feed = candlesFeed(store, 1, "15m");
    const got = await feed.read(null, () => true);
    expect(client.marksReads).toEqual([{ market: 1, resolution: "1m", fromMs: NOW - 900 * 120 * 1000, toMs: NOW }]);
    expect(got).toMatchObject({ complete: true, provenance: "log_derived" });
    expect(got.bars).toHaveLength(1);
  });

  it("keeps the candles it holds when a read is stopped between pages, and takes the partial only with nothing held", async () => {
    const { client, store } = setup();
    store.patch({ now: NOW });
    client.marksPages = [{ entries: [{ ts: NOW - 60_000, open: "1", high: "1", low: "1", close: "1", provenance: "log_derived" }], next: NOW - 30_000 }];
    const feed = candlesFeed(store, 1, "15m");
    const held = { bars: [], provenance: null, complete: true };
    expect(await feed.read(held, () => false)).toBe(held);
    expect((await feed.read(null, () => false)).complete).toBe(false);
  });

  it("marks the page blocked when a feed's read is refused for the caller's region, and shows no toast", async () => {
    const { client, store } = setup();
    client.statsError = new EngineError(403, "not available in your region", { kind: "access", reason: "united_states" });
    store.houseStats.setOpen(true);
    store.houseStats.follow(positionsFeed(store, 1));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().blocked).toBe("united_states");
    expect(store.getSnapshot().toasts).toEqual([]);
  });
});
