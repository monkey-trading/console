/** The House page's feeds: what each dashboard panel reads from the node, and at what pace. */

import { secondsOf, type TimeframeId } from "../bars";
import { fetchBarsHistory, type FetchedBars } from "../engine/marks-fetch";
import type { MonkeyView, PositionsView, SeriesMetric } from "../engine/stats-types";
import type { MarketId } from "../engine/types";
import { foldSeries, nextQuery, rangeOf, seriesQuery, type RangeId, type SeriesData } from "../house-series";
import type { FeedSpec } from "./house-stats";
import type { ConsoleStore } from "./store";

/** How often the scan-derived reads repeat: the node scans once per `api.stats_interval`, 60 s by default. */
export const SCAN_EVERY_MS = 30_000;
/** How often a chart set to Live reads. */
export const LIVE_EVERY_MS = 5_000;
/** The candles the close-out map draws behind its bands. */
const MAP_BARS = 120;

/** The node's clock; a series window is anchored to it, never to the device's. */
function nodeNow(store: ConsoleStore): number {
  const { now } = store.getSnapshot();
  if (now === 0) throw new Error("The node's time is not known yet.");
  return now;
}

/**
 * One metric over one range. The first read takes the whole window; later reads ask from the last
 * bucket held, so a live chart reads a few buckets, not the window again.
 */
export function seriesFeed(store: ConsoleStore, metric: SeriesMetric, market: MarketId | null, range: RangeId, live: boolean): FeedSpec<SeriesData> {
  return {
    key: `series:${metric}:${market ?? "-"}:${range}`,
    everyMs: live ? LIVE_EVERY_MS : SCAN_EVERY_MS,
    async read(previous) {
      const now = nodeNow(store);
      const full = seriesQuery(metric, market, range, now);
      const page = await store.deps.client.stats.series(nextQuery(full, previous));
      return foldSeries(previous, page, now - rangeOf(range).spanMs);
    },
  };
}

/** One market's positions by close-out price and by profit, from the node's last scan. */
export function positionsFeed(store: ConsoleStore, market: MarketId): FeedSpec<PositionsView> {
  return { key: `positions:${market}`, everyMs: SCAN_EVERY_MS, read: () => store.deps.client.stats.positions(market) };
}

/** The MONKEY totals and the distribution's liquidity floor. */
export function monkeyFeed(store: ConsoleStore): FeedSpec<MonkeyView> {
  return { key: "monkey", everyMs: 60_000, read: () => store.deps.client.stats.monkey() };
}

/** A market's recent index candles for the close-out map, from the marks route (never a log scan), with where they came from and whether the window was covered. */
export function candlesFeed(store: ConsoleStore, market: MarketId, timeframe: TimeframeId): FeedSpec<FetchedBars> {
  return {
    key: `candles:${market}:${timeframe}`,
    everyMs: SCAN_EVERY_MS,
    async read(previous, alive) {
      const now = nodeNow(store);
      const fetched = await fetchBarsHistory(store.deps.client, market, timeframe, now - secondsOf(timeframe) * MAP_BARS * 1000, now, alive);
      // A read stopped between pages holds only the oldest span; the candles already held are the better answer.
      return previous !== null && !fetched.complete && !alive() ? previous : fetched;
    },
  };
}
