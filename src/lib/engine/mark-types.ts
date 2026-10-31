/**
 * The marks-history shapes of `GET /v1/markets/{id}/marks`, split out of types.ts: one page of a
 * market's index marks at one resolution, each entry labelled with where the node got it.
 */

/** The granularity of `GET /v1/markets/{id}/marks`, as the node's derived marks cache retains it. */
export type MarkResolution = "1s" | "1m" | "1h" | "1d";

/**
 * Where a served mark came from: `seeded_from_provider` is history the node fetched from its data
 * providers to fill day one (provider data, not independently replayable from the log);
 * `log_derived` is history the node derived from the sequenced log, as recovery derives it.
 */
export type MarkProvenance = "seeded_from_provider" | "log_derived";

/** One mark of `GET /v1/markets/{id}/marks`: the market's index at `t_ms`. */
export interface MarkEntry {
  /** Unix milliseconds. */
  t_ms: number;
  /** The index mid, in the engine's nine-place fixed point, as every wire price travels. */
  mid: string;
  provenance: MarkProvenance;
}

/** One page of `GET /v1/markets/{id}/marks`: entries ascending by `t_ms`, capped per response. */
export interface MarkPage {
  entries: MarkEntry[];
  /**
   * The `from_ms` the next page answers from, non-null while the window still has entries the
   * response cap kept out; null when the page reached `to_ms`.
   */
  next_from_ms: number | null;
}
