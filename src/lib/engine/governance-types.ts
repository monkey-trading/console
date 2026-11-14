/**
 * The node's signed answers about parameter votes (monkey-trading/engine#548, from protocol V56):
 * `GET /v1/operators`' open proposals, which the custody quorum read from the vote contract at the
 * list's final block (`custody/operators/proposals.rs`), and `GET /v1/house/state`'s `governance`,
 * the passed changes waiting out their notice and the fast-path restrictions in force as the log
 * holds them (`engine_core::governance`). Weights are MONKEY base units as decimal strings; times
 * are milliseconds.
 */

import type { Address, MarketId, Tier } from "./types";

/** An admin command as the engine serialises it, tagged by `action` (`engine_core::command::AdminCommand`). */
export interface AdminCommandWire {
  action: string;
  [field: string]: unknown;
}

/** A proposal still taking votes at the list's block. */
export interface OpenProposalWire {
  id: number;
  proposer: Address;
  set_id: number;
  fast: boolean;
  opens_at_ms: number;
  closes_at_ms: number;
  /** The set's total weight, of which more than two thirds passes it. */
  total_weight: string;
  yes_weight: string;
  command_hash: string;
  /** The admin command the bytes are the canonical JSON of; null for bytes that are none, which the engine refuses if the proposal passes. */
  command: AdminCommandWire | null;
}

/** `GET /v1/operators`' `proposals`, present when the node follows a vote contract. */
export interface OpenProposalsWire {
  /** The vote contract. */
  vote: Address;
  /** Newest first. */
  open: OpenProposalWire[];
  /** Whether the node's read stopped before every proposal that could still be open. */
  truncated: boolean;
  /** Whether the read failed, so none are listed though some may be open; absent when false. */
  unavailable?: boolean;
}

/** What a fast-path restriction holds: each value is a bound the value in force may not pass. */
export type LimitWire =
  | { kind: "params"; closeout_level_bps?: number; house_total_cap_bps?: number; house_total_cap_floor?: string }
  | { kind: "market"; market: MarketId; margin_tiers?: Tier[]; house_cap_bps?: number; house_cap_floor?: string }
  | { kind: "stress_floor"; market: MarketId | null; level: number }
  | { kind: "reduce_only"; market: MarketId | null };

/** A passed normal change waiting out its seven days. */
export interface PendingChangeWire {
  proposal: number;
  command: AdminCommandWire;
  /** The hash of what a `set_params` or `upsert_market` replaces, over which alone it applies. */
  basis?: string;
  applies_at: number;
}

/** A fast-path restriction in force until `expires_at`. */
export interface RestrictionWire {
  limit: LimitWire;
  command_hash: string;
  expires_at: number;
}

/** `GET /v1/house/state`'s `governance`: absent before any vote is recorded; each part absent while empty. */
export interface GovernanceWire {
  config?: { vote: Address; restriction_ttl_ms: number };
  /** In the order mirrored, which is the order they apply in. */
  pending?: PendingChangeWire[];
  /** By proposal id. */
  restrictions?: Record<string, RestrictionWire>;
  turns_drawn?: boolean;
  /** The parameters' restricted fields as the baseline sets them, while a restriction holds one. */
  params_baseline?: { closeout_level_bps: number; house_total_cap_bps: number; house_total_cap_floor: string };
  /** Each market's restricted fields as the baseline sets them, by market id. */
  market_baselines?: Record<string, { margin_tiers: Tier[]; house_cap_bps: number; house_cap_floor: string }>;
}
