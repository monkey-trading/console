/**
 * What the chain says about who may run the node and who stands for it: the vault's current release
 * and signer, and the operator registry's named operator, pending election and candidates. Read
 * through the connected wallet, whose RPC the console does not control, so every value here is a
 * claim: a hostname decides a connection only if the build lists its origin, and a release or signer
 * only if a hardware quote for pinned code agrees with it.
 */

import type { Address } from "./types";

/** The vault's two names for the node: the release that holds the keys, and the address they sign as. */
export interface VaultFacts {
  /** `currentRelease()`, lowercase `0x` hex. */
  release: string;
  /** `checkpointSigner()`, lowercase `0x` hex. */
  signer: string;
}

/** An election waiting to take effect (`OperatorRegistry.pendingElection`). */
export interface PendingElection {
  epoch: number;
  candidate: Address;
  adminKey: Address;
  /** When it takes effect, in chain time, in milliseconds. */
  effectiveAtMs: number;
  /** A liveness promotion, which moves the vault's release at once and the admin key at `effectiveAtMs`. */
  promoted: boolean;
}

/** The operator the vault names (`OperatorRegistry.namedOperator`), and what its candidacy registered. */
export interface NamedOperator {
  rotationEnabled: boolean;
  candidate: Address;
  adminKey: Address;
  /** The start of its term, in chain time, in milliseconds. */
  sinceMs: number;
  /** Its registered API hostname, as the chain answered; null for an operator that never registered, such as the deployer. */
  hostname: string | null;
  pending: PendingElection | null;
}

/** One candidate the timelock approved. */
export interface Candidate {
  address: Address;
  /** Its registered API hostname, as the chain answered. */
  hostname: string;
  /** MONKEY base units delegated to it. */
  votes: bigint;
  /** Whether it would count in a close now: its bond and share of stake meet the minimums. */
  eligible: boolean;
}

/** The registry's candidates and the stake their votes are a share of. */
export interface CandidateTable {
  candidates: readonly Candidate[];
  /** MONKEY base units staked across every account, unstaking amounts excluded. */
  totalStaked: bigint;
}

/**
 * A wallet's reads of the deployment's contracts. Each asks one thing at a time, and is refused when
 * the wallet sits on another chain. `operator` and `candidates` answer null when the build names no registry.
 */
export interface DeploymentReads {
  vault(): Promise<VaultFacts>;
  operator(): Promise<NamedOperator | null>;
  candidates(): Promise<CandidateTable | null>;
}

/** The registry's bound on its candidate list (`OperatorRegistry.CANDIDATE_LIMIT`): an RPC that claims more is not read further. */
export const CANDIDATE_LIMIT = 100;

/** What delegating to no one sends: the stake abstains. */
export const NO_CANDIDATE = "0x0000000000000000000000000000000000000000";
