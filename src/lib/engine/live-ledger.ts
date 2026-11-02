/** The live client's reads for the P&L ledger: the history query and the emission schedule, which comes from the one `/v1/monkey` read. */

import { EngineError } from "./client";
import { decodeSchedule, type EmissionSchedule, type EmissionsWire } from "./emission-schedule";

/** The path of `GET /v1/accounts/{address}/history` with the query a page asks for. */
export function historyPath(address: string, params: { limit?: number; before?: string; kind?: string }): string {
  const query = new URLSearchParams();
  if (params.kind !== undefined) query.set("kind", params.kind);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.before !== undefined) query.set("before", params.before);
  return `/v1/accounts/${address}/history${query.size > 0 ? `?${query}` : ""}`;
}

/**
 * The emission schedule from `GET /v1/monkey`, or null from a node that predates the route (404)
 * or reports no emissions. Any other failure rejects. `monkey` is the client's one read of the
 * route, which answers only what the enclave signed.
 */
export async function readEmissionSchedule(monkey: () => Promise<{ emissions: EmissionsWire | null }>): Promise<EmissionSchedule | null> {
  try {
    return decodeSchedule((await monkey()).emissions);
  } catch (error) {
    if (error instanceof EngineError && error.status === 404) return null;
    throw error;
  }
}
