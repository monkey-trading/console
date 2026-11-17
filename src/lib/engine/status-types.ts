/** The server's operating state, `GET /v1/status` and the signed stream's `status` frames, as `crates/node/src/status.rs` serializes it (monkey-trading/engine#866). */

import type { MarketId } from "./types";

/** What stops the server taking orders. */
export type HoldCause = "trusted_time" | "log_sync_held" | "log_rollback";

/** A venue connection's state for one symbol, best first; a venue shows the worst of its symbols. */
export type VenueState = "not_expected" | "quoting" | "stale" | "silent" | "delayed" | "down" | "off";

/** Why an open market has no price (`crates/node/src/api/pricing.rs`). */
export type UnpricedReason = "too_few_sources" | "diverging" | "out_of_range";

export interface ServerStatus {
  as_of_ms: number;
  /** False while any of `holds` stands. */
  takes_orders: boolean;
  holds: { cause: HoldCause; since_ms: number }[];
  trusted_time: { state: "starting" } | { state: "sampled"; last_sample_ms: number } | { state: "held"; cause: "no_sample" | "drift"; last_sample_ms: number };
  /**
   * Each venue once, however many connections carry it (`connections`, as Coinbase's two): a symbol
   * several of them carry is listed once, in the best state any of them reports.
   */
  venues: { venue: string; connections: number; state: VenueState; symbols: { symbol: string; market: MarketId; state: VenueState }[] }[];
  /** The markets open for trading that have no price. */
  unpriced_markets: { market: MarketId; symbol: string; reason: UnpricedReason; fresh_sources: number; min_sources: number }[];
}

/**
 * What the console last learned of the server's operating state: a signed answer, an answer the
 * server did not sign (it signs nothing while it cannot bound its clock, so it cannot currently be
 * verified), or no answer at all.
 */
export type ServerRead = { kind: "signed"; status: ServerStatus } | { kind: "unsigned" } | { kind: "unreachable" };
