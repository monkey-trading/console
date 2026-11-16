/** The dashboard routes over a signed read: the House, MONKEY and Staking pages' positions, series and totals. */

import { EngineError } from "./client";
import { RefusedAnswer, SupersededAnswer, UntrustedError } from "./trust-errors";
import type { NamedSigner, OperatorClaim } from "./signer-naming";
import type { DistributionEpochsPage, OperatorList } from "./staking-reads";
import type { ActivityPage, DistributionProof, MonkeyView, OperatorRoute, PositionsView, SeriesPage, SeriesQuery, StatsReads } from "./stats-types";

/**
 * Reads the routes through `get` (`seen` keeps the last operator route read), which answers only what the attested enclave signed for that
 * request; `heedOperator` judges the signer the operator route names, and `heedSigner` the signer named by one that came under a key put aside.
 */
export function liveStats(get: (path: string) => Promise<unknown>, heedOperator: (route: OperatorRoute) => void = () => undefined, seen: { route: OperatorRoute | null } = { route: null }, heedSigner: (signer: NamedSigner) => void = () => undefined): StatsReads {
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
      let route: OperatorRoute;
      try {
        route = (await get(`/v1/operator${text === "" ? "" : `?${text}`}`)) as OperatorRoute;
      } catch (error) {
        if (error instanceof SupersededAnswer) {
          // Refused, as its key was put aside while it came, but what it names of the signer counts (monkey-trading/console#377); the enclave signed it, so its shape is the engine's.
          const late = error.body as OperatorRoute;
          if (late.signer !== undefined) heedSigner(late.signer);
          throw new RefusedAnswer(error.message, late);
        }
        // A node refused at its check cannot be asked again, but what it last said stays with the refusal: it still says which node the registry names now.
        throw error instanceof UntrustedError && !(error instanceof RefusedAnswer) && seen.route !== null ? new RefusedAnswer(error.message, seen.route) : error;
      }
      seen.route = route;
      try {
        heedOperator(route);
      } catch (error) {
        throw error instanceof UntrustedError ? new RefusedAnswer(error.message, route) : error;
      }
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

/**
 * What a node's operator route, read by `read`, says of its own enclave and the signer the vault names; `seen` keeps the route. A node
 * that predates the route says so in a signed 404 and states nothing.
 * Error cases:
 * - any other failure, the read's own error: an answer that never came, is unsigned or does not verify says nothing of the signer
 */
export async function readClaim(read: () => Promise<unknown>, seen: { route: OperatorRoute | null }): Promise<OperatorClaim> {
  let route: OperatorRoute;
  try {
    route = (await read()) as OperatorRoute;
  } catch (error) {
    // The transport raises an `EngineError` with an HTTP status only for an answer the enclave signed.
    if (error instanceof EngineError && error.status === 404) return {};
    throw error;
  }
  seen.route = route;
  return { ...(route.enclave === undefined ? {} : { enclave: route.enclave }), ...(route.signer === undefined ? {} : { signer: route.signer }) };
}
