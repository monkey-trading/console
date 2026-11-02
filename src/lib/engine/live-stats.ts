/** The dashboard routes over a signed read: the House and MONKEY pages' positions, series and totals. */

import type { MonkeyView, PositionsView, SeriesPage, SeriesQuery, StatsReads } from "./stats-types";

/** Reads the routes through `get`, which answers only what the attested enclave signed for that request. */
export function liveStats(get: (path: string) => Promise<unknown>): StatsReads {
  // The enclave signs each answer, so its shape is the engine's.
  return {
    positions: async (market) => (await get(`/v1/house/positions?${new URLSearchParams({ market: String(market) })}`)) as PositionsView,
    series: async (query: SeriesQuery) => {
      const params = new URLSearchParams({ metric: query.metric, resolution: query.resolution, from_ms: String(query.fromMs), to_ms: String(query.toMs), limit: String(query.limit) });
      if (query.market !== null) params.set("market", String(query.market));
      return (await get(`/v1/stats/series?${params}`)) as SeriesPage;
    },
    monkey: async () => (await get("/v1/monkey")) as MonkeyView,
  };
}
