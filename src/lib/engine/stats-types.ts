/**
 * The dashboard routes' wire shapes: `/v1/house`'s scan figures, `/v1/house/positions`,
 * `/v1/stats/series` and `/v1/monkey`, as the node serves them. Every amount is a decimal string
 * (the engine's nine-place `Fixed`, or whole base units for the MONKEY and USDC counts).
 */

import type { Address, MarketId } from "./types";

/** `/v1/house`'s added figures. A scan figure is null until the node's first scan; a node that predates the routes omits them. */
export interface HouseScanView {
  seq?: number | null;
  snapshot_ms?: number | null;
  open_interest?: string | null;
  open_margin?: string | null;
  open_positions?: number | null;
  unrealised?: string;
  volume?: string;
  volume_since_ms?: number;
  markets?: HouseMarketView[];
}

/** One market's row of `/v1/house`: clients' long and short notional at the scan. */
export interface HouseMarketView {
  market: MarketId;
  symbol: string;
  mark: string | null;
  long: string | null;
  short: string | null;
  net: string | null;
  long_positions: number | null;
  short_positions: number | null;
  unrealised: string;
  volume: string;
}

/** Notional and count of positions on one side. */
export interface SideCell {
  usd: string;
  count: number;
}

/** A bucket's positions by side, as the node flattens them. */
export interface SideCounts {
  long_usd: string;
  long_count: number;
  short_usd: string;
  short_count: number;
}

export interface CloseoutBucketView extends SideCounts {
  /** The move from the mark that closes the account out, in basis points: from inclusive, to exclusive. */
  from_bps: number;
  to_bps: number;
  from_price: string | null;
  to_price: string | null;
}

export interface ProfitBucketView extends SideCounts {
  /** A position's profit as a share of its entry, in basis points; null at the open ends. */
  from_bps: number | null;
  to_bps: number | null;
}

/** `GET /v1/house/positions?market=`: one market's positions by close-out price and by profit, from the last scan. */
export interface PositionsView {
  market: MarketId;
  symbol: string;
  seq: number;
  snapshot_ms: number;
  mark: string | null;
  closeout_range_bps: number;
  closeout_bucket_bps: number;
  profit_range_bps: number;
  profit_bucket_bps: number;
  long: SideCell;
  short: SideCell;
  due_now: SideCounts;
  closeout: CloseoutBucketView[];
  beyond_range: SideCounts;
  profit: ProfitBucketView[];
}

export type HouseSeriesMetric = "nav" | "cash" | "withdrawal_queue" | "long" | "short" | "volume";
/** The MONKEY page's series: MONKEY base units staked and allocated, USDC base units distributed (cumulative and per epoch), and MONKEY base units per dollar of realised loss by period. */
export type MonkeySeriesMetric = "total_staked" | "total_allocated" | "cumulative_distributed" | "monkey_per_loss" | "distributed_per_epoch";
export type SeriesMetric = HouseSeriesMetric | MonkeySeriesMetric;
export type SeriesResolution = "1m" | "1h" | "1d";

/** A level series' bucket. */
export interface LevelEntry {
  ts: number;
  open: string;
  high: string;
  low: string;
  close: string;
}

/** A flow or ratio series' bucket. */
export interface ValueEntry {
  ts: number;
  value: string;
}

/** `GET /v1/stats/series`: one page of a metric, oldest first, with where its data begins. */
export interface SeriesPage {
  metric: string;
  market: MarketId | null;
  resolution: SeriesResolution;
  kind: "level" | "flow" | "ratio";
  unit: string;
  begins_ms: number | null;
  begins_seq: number | null;
  from_genesis: boolean;
  retained_from_ms: number | null;
  entries: (LevelEntry | ValueEntry)[];
  next: number | null;
  max_limit: number;
}

/** What a series read asks for. */
export interface SeriesQuery {
  metric: SeriesMetric;
  market: MarketId | null;
  resolution: SeriesResolution;
  fromMs: number;
  toMs: number;
  limit: number;
}

/** `GET /v1/monkey`: the emission schedule, staking, and the distribution state; a group is null until the operator configures it. */
export interface MonkeyView {
  seq: number | null;
  time_ms: number;
  begins_ms: number | null;
  begins_seq: number | null;
  from_genesis: boolean;
  emissions: {
    start_ms: number;
    period_ms: number;
    period_budget: string;
    halving_periods: number;
    period: number | null;
    current_budget: string | null;
    next_halving_ms: number | null;
    max_supply: string;
    allocated: string;
    cancelled: string;
  } | null;
  staking: { total_staked: string; stakers: number; cooldown_ms: number } | null;
  distribution: {
    start_ms: number;
    epoch_ms: number;
    liquidity_floor: string;
    nav: string;
    excess_usd: string | null;
    excess_seq: number | null;
    epoch: number;
    last_closed_epoch: number | null;
    last_closed_ms: number | null;
    next_close_ms: number;
    distributed_usdc_units: string;
    /** The last close this record saw, with what it measured; null before one. */
    last_distribution: {
      epoch: number;
      closed_ms: number;
      nav: string;
      floor: string;
      excess_usdc_units: string;
      allocated_usdc_units: string;
    } | null;
  } | null;
}

/** The groups of `/v1/monkey`, each null until the operator configures it. */
export type EmissionsView = NonNullable<MonkeyView["emissions"]>;
export type StakingView = NonNullable<MonkeyView["staking"]>;
export type DistributionView = NonNullable<MonkeyView["distribution"]>;

export type ActivityKind = "loss_close" | "stake" | "unstake";

/** One public MONKEY event. */
export interface ActivityEntry {
  /** Orders entries in time; a decimal string, since it passes what a JavaScript number holds. */
  id: string;
  seq: number;
  ts: number;
  type: ActivityKind;
  account: Address;
  /** MONKEY base units. */
  amount: string;
  /** The emission period of a `loss_close`. */
  period: number | null;
}

/** `GET /v1/monkey/activity`: the newest events first. */
export interface ActivityPage {
  entries: ActivityEntry[];
  next: string | null;
  begins_ms: number | null;
  begins_seq: number | null;
  from_genesis: boolean;
  truncated: boolean;
  retained_from_ms: number | null;
}

/** `GET /v1/accounts/{address}/distributions`: the proof the vault's `claimDistribution` takes. */
export interface DistributionProof {
  /** The seq the root was computed at; a claim works only while the vault's latest posted seq equals it. */
  seq: number;
  root: string;
  account: Address;
  /** The account's cumulative USDC distribution in base units. */
  entitled: string;
  siblings: string[];
}

/** The dashboard's reads, kept apart from the rest of the client so a node without the routes answers 404 to them alone. */
export interface StatsReads {
  positions(market: MarketId): Promise<PositionsView>;
  series(query: SeriesQuery): Promise<SeriesPage>;
  monkey(): Promise<MonkeyView>;
  /** The newest MONKEY events, newest first, older than `before`. */
  activity(params: { limit?: number; before?: string }): Promise<ActivityPage>;
  /** The account's distribution proof, or null when the node holds none for it. */
  distributions(address: Address): Promise<DistributionProof | null>;
  /** Contract addresses a client knows without a deployment config; only the mock names any. */
  readonly contracts?: { token: string; staking: string };
}
