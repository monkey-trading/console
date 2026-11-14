/**
 * The pricing shapes the node serves, field for field as `engine_core` serializes them: spread bands
 * (`spread_tier.rs`), stress levels (`params.rs`), the profit fee's hold curve and a position's close
 * fee (`holding_fee`), and a listed market's pending listing notice (`listing_bounds.rs`).
 */

import type { MarketId, Tier } from "./types";

/**
 * A size spread band: its rate applies to the slice of position notional (USD) up to `up_to`, null
 * for the unbounded last band. From V52 the rate is in tenths of a bp (`tenth_bps`); a log from
 * before it writes whole bps (`bps`), and the engine charges either at the same rate.
 */
export type SpreadTier = { up_to: string | null; tenth_bps: number } | { up_to: string | null; bps: number };

/** One stress level: a multiplier on the size spread, in bps (10_000 is 1x), and a spread every fill pays, in bps. */
export interface StressLevel {
  size_spread_multiplier_bps: number;
  min_spread_bps: number;
}

/** One point of the profit fee's hold curve (from V55): the fee, in bps of the gain, on a slice held `hold_ms`. */
export interface CurvePoint {
  hold_ms: number;
  fee_bps: number;
}

/**
 * What closing one position pays now, as `GET /v1/accounts/{address}`'s `close_fees` gives it from V55:
 * its open time, the fee rate on a gain, and when that rate next falls (null once it is the base), as of
 * the engine's last sequenced time.
 */
export interface CloseFee {
  opened_at: number;
  fee_bps: number;
  falls_at: number | null;
}

/** A listed market's pending listing notice (V49, from V52 its bands): each named value applies from `effective_at`. */
export interface ListingNotice {
  spread_tiers?: SpreadTier[];
  margin_tiers?: Tier[];
  markup_bps?: number;
  effective_at: number;
}

/** `/v1/house/state`'s `listing_notices`: each listed market with a pending notice, by market id. */
export type ListingNotices = Partial<Record<MarketId, ListingNotice>>;
