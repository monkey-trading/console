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

/**
 * A wallet's reads of the deployment's contracts, which decide the node the console talks to. Each
 * asks one thing at a time, and is refused when the wallet sits on another chain. `operator` answers
 * null when the build names no registry. The Staking page's candidate list is the node's signed
 * `GET /v1/operators` instead (monkey-trading/console#279).
 */
export interface DeploymentReads {
  vault(): Promise<VaultFacts>;
  operator(): Promise<NamedOperator | null>;
}

/** The zero address, which the registry answers for no candidate. */
export const NO_CANDIDATE = "0x0000000000000000000000000000000000000000";
