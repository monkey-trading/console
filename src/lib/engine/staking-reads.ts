/**
 * The node's signed staking reads (monkey-trading/engine#590): `GET /v1/operators`, the operator
 * registry's candidates and parameters as the custody quorum read them through `RegistryLens` at one
 * final block, and `GET /v1/monkey/distributions`, the closed distribution epochs newest first. The
 * enclave signs each answer, so the shapes are the engine's (`custody/operators/lens.rs`,
 * `stats/distributions.rs`). Amounts are decimal strings in base units; times are milliseconds.
 */

import type { Address } from "./types";

/** The block a list was read at: its height, hash and chain time, which a majority of providers declared final. */
export interface ListBlock {
  number: number;
  hash: string;
  time_ms: number;
}

/** An operator the registry names (`OperatorRegistry.Operator`). */
export interface ListedOperator {
  candidate: Address;
  admin_key: Address;
  release: string;
  since_ms: number;
}

/** An election or liveness promotion waiting to take effect. */
export interface ListedElection {
  epoch: number;
  candidate: Address;
  admin_key: Address;
  release: string;
  effective_at_ms: number;
  /** A liveness promotion, which names its release at once. */
  promoted: boolean;
}

/** `operator` is in effect, `elected` is named by an election or promotion still waiting, `candidate` is neither. */
export type ListedRole = "candidate" | "elected" | "operator";

/** One candidate the timelock approved, as the registry and the staking contract hold it. */
export interface ListedCandidate {
  address: Address;
  admin_key: Address;
  enclave: Address;
  /** MONKEY base units. */
  self_bond: string;
  release: string;
  /** Registrations before this one: lower is earlier, which breaks a tie in votes. */
  registration: number;
  api_hostname: string;
  handover_endpoint: string;
  /** MONKEY base units delegated to it. */
  votes: string;
  eligible: boolean;
  role: ListedRole;
}

/** The registry's bound on its candidate list (`OperatorRegistry.CANDIDATE_LIMIT`): a list that names more is refused. */
export const CANDIDATE_LIMIT = 100;

/** `GET /v1/operators`. */
export interface OperatorList {
  block: ListBlock;
  registry: Address;
  lens: Address;
  rotation_enabled: boolean;
  parameters: {
    epoch_length_secs: number;
    min_term_secs: number;
    finality_margin_secs: number;
    margin_bps: number;
    eligibility_bps: number;
    quorum_bps: number;
    max_candidates: number;
    min_self_bond: string;
    liveness_timeout_secs: number;
  };
  open_epoch: number;
  open_epoch_start_ms: number;
  /** MONKEY base units staked across every account, unstaking amounts excluded. */
  total_staked: string;
  operator_in_effect: ListedOperator;
  /** The operator the vault names: a promoted standby from the moment of its promotion. */
  named_operator: ListedOperator;
  pending_election: ListedElection | null;
  pending_promotion: boolean;
  /** Listed candidates by registration order, at most 100. */
  candidates: ListedCandidate[];
}

/** One recipient of a close's operator share. */
export interface OperatorShare {
  account: Address;
  /** USDC base units. */
  amount: string;
}

/** One closed distribution epoch, as its close's events said. */
export interface EpochClose {
  epoch: number;
  close_seq: number;
  close_ms: number;
  ended_ms: number;
  /** Engine `Fixed` decimals. */
  nav: string;
  floor: string;
  /** USDC base units. */
  excess_usdc_units: string;
  allocated_usdc_units: string;
  stakers_usdc_units: string;
  stakers: number;
  /** In the order the close allocated them; empty while rotation is off. */
  operator_shares: OperatorShare[];
  /** Epochs before this one whose end no command witnessed, which this close distributed nothing for. */
  skipped: { first: number; last: number } | null;
}

/** `GET /v1/monkey/distributions`: closed epochs newest first, and where the record behind them begins. */
export interface DistributionEpochsPage {
  seq: number | null;
  time_ms: number;
  epochs: EpochClose[];
  /** The `before` for the next older page; null when none is held. */
  next: number | null;
  begins_ms: number | null;
  begins_seq: number | null;
  from_genesis: boolean;
  /** Whether older epochs were dropped for room; `retained_from_epoch` is then the oldest held. */
  truncated: boolean;
  retained_from_epoch: number | null;
}
