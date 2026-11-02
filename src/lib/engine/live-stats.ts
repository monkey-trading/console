/** The dashboard routes over a signed read: the House and MONKEY pages' positions, series and totals. */

import { EngineError } from "./client";
import type { ActivityPage, DistributionProof, MonkeyView, PositionsView, SeriesPage, SeriesQuery, StatsReads } from "./stats-types";

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
    activity: async (params) => {
      const query = new URLSearchParams();
      if (params.limit !== undefined) query.set("limit", String(params.limit));
      if (params.before !== undefined) query.set("before", params.before);
      return (await get(`/v1/monkey/activity${query.size > 0 ? `?${query}` : ""}`)) as ActivityPage;
    },
    distributions: async (address) => {
      try {
        return (await get(`/v1/accounts/${address}/distributions`)) as DistributionProof;
      } catch (error) {
        // No checkpoint holds a distribution for the account, or the node predates the route.
        if (error instanceof EngineError && error.status === 404) return null;
        throw error;
      }
    },
  };
}

/** The reads of a client whose node has no dashboard routes: each answers 404, as such a node does, and no distribution is held. */
export const NO_STATS: StatsReads = {
  positions: () => Promise.reject(new EngineError(404, "not found")),
  series: () => Promise.reject(new EngineError(404, "not found")),
  monkey: () => Promise.reject(new EngineError(404, "not found")),
  activity: () => Promise.reject(new EngineError(404, "not found")),
  distributions: () => Promise.resolve(null),
};
