/** The dashboard routes over a signed read: the House, MONKEY and Staking pages' positions, series and totals. */

import { EngineError } from "./client";
import type { OperatorClaim } from "./signer-naming";
import type { DistributionEpochsPage, OperatorList } from "./staking-reads";
import type { ActivityPage, DistributionProof, MonkeyView, OperatorRoute, PositionsView, SeriesPage, SeriesQuery, StatsReads } from "./stats-types";

/** Reads the routes through `get`, which answers only what the attested enclave signed for that request; `heedOperator` judges the signer the operator route names. */
export function liveStats(get: (path: string) => Promise<unknown>, heedOperator: (route: OperatorRoute) => void = () => undefined): StatsReads {
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
    operator: async (params) => {
      const query = new URLSearchParams();
      if (params?.before !== undefined) query.set("before", String(params.before));
      if (params?.limit !== undefined) query.set("limit", String(params.limit));
      const text = query.toString();
      const route = (await get(`/v1/operator${text === "" ? "" : `?${text}`}`)) as OperatorRoute;
      // The signer the node says the vault names is judged before anyone reads the answer.
      heedOperator(route);
      return route;
    },
    operators: async () => (await get("/v1/operators")) as OperatorList,
    distributionEpochs: async (params) => {
      const query = new URLSearchParams();
      if (params.limit !== undefined) query.set("limit", String(params.limit));
      if (params.before !== undefined) query.set("before", String(params.before));
      return (await get(`/v1/monkey/distributions${query.size > 0 ? `?${query}` : ""}`)) as DistributionEpochsPage;
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
  operator: () => Promise.reject(new EngineError(404, "not found")),
  operators: () => Promise.reject(new EngineError(404, "not found")),
  distributionEpochs: () => Promise.reject(new EngineError(404, "not found")),
};

/** What a node's operator route says of its own enclave and the signer the vault names. */
export const claimOf = (route: OperatorRoute): OperatorClaim => ({ ...(route.enclave === undefined ? {} : { enclave: route.enclave }), ...(route.signer === undefined ? {} : { signer: route.signer }) });
