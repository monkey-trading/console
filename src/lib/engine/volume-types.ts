/**
 * The volume-tier shapes the node serves, field for field as `engine_core` serializes them
 * (`volume_tier`, `toxicity`, `engine::margin`): a tier's terms in the house parameters, and an
 * account's volume, toxicity and margin standing in `GET /v1/accounts/{address}`.
 */

/** One volume tier of the table in the house parameters (V59); the floor, limit and rate are absent while the table names none (V64, V66). */
export interface VolumeTierWire {
  /** The counted volume over the window, in USD, that reaches the tier. */
  threshold: string;
  /** A day counts at most `threshold / day_divisor`, so the tier takes trading on at least this many days. */
  day_divisor: number;
  /** Where the account's first spread band ends, in bps of the market's first bound. */
  best_price_share_bps: number;
  /** The least rate each margin band charges in the account's initial requirement, in bps. */
  margin_floor_bps?: number;
  /** The resting orders an account at this tier may hold. */
  max_resting_orders?: number;
  /** The signed requests a second the node admits from an account at this tier. */
  requests_per_second?: number;
  /** From V68, the share of the base profit fee the tier takes off, of the markup it takes off financing, and the share it adds to the account's emission weight, each in bps. */
  fee_discount_bps?: number;
  financing_discount_bps?: number;
  emissions_boost_bps?: number;
}

/** How far an account is towards one tier. */
export interface TierProgressWire {
  /** The counted volume the tier's day cap admits, which reaches the tier at its threshold. */
  capped: string;
  /** The days of the window whose counted volume reaches the tier's day cap. */
  days: number;
}

/** An account's volume as the account read gives it (V59; the limits from V66). */
export interface VolumeStandingWire {
  tier: number;
  matured: string;
  pending: string;
  /** Each tier's progress, tier 0 first. */
  progress: TierProgressWire[];
  /** Where each market's first band ends for the account, in USD, by market id; a market with one band is left out. */
  best_price_bounds: Record<string, string>;
  max_resting_orders?: number;
  requests_per_second?: number;
  /** From V68, this tier's benefits as the table names them: left out by a node that predates V68. */
  fee_discount_bps?: number;
  financing_discount_bps?: number;
  emissions_boost_bps?: number;
}

/** An account's toxicity score as the account read gives it (V54): the tier that applies, counted from 1 (0 for none), and the spread it adds in bps. */
export interface ToxicityStandingWire {
  score: string;
  fills: string;
  tier: number;
  add_on_bps: number;
}

/** The margin standing the account read gives from V64, beside `margin`. */
export interface MarginStandingWire {
  initial_margin?: string;
  maintenance_margin?: string;
  withdrawable?: string;
  /** The most leverage a position opened now can take in each listed market, by market id. */
  max_leverage?: Record<string, string>;
}
