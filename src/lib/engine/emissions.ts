/**
 * MONKEY emissions as the node serves them: the account's cumulative entitlement with its proof,
 * field for field as `engine_core::merkle::EntitlementProof` serializes. `entitled` counts MONKEY
 * base units (18 decimals), not the engine's nine-place `Fixed`, so it stays a decimal string here
 * and a bigint in the store.
 */

import type { Address } from "./types";

/**
 * What a claim answer says beside its proof, as the node's `ClaimAnswer` serializes it: the proof is
 * at the checkpoint the vault has accepted when the node kept one, which can be older than its
 * newest. Optional, since a node that predates them leaves them out.
 */
export interface ClaimStanding {
  /** The latest checkpoint the node has seen the vault accept in its signer epoch in force; null before it has seen one, and while the signer that recorded it is replaced or retired. */
  accepted_seq?: number | null;
  /** The newest checkpoint the node has created. */
  newest_seq?: number;
  /** The account's cumulative amount at the newest checkpoint, as a decimal string: what the proof names once the vault accepts that checkpoint. Never below the proof's own `entitled`. */
  newest_entitled?: string;
  /** Whether the proof is against the checkpoint the vault last accepted, so a claim can land now. */
  claimable?: boolean;
}

/** `GET /v1/accounts/{address}/emissions`: the proof the vault's `claimEmissions` takes, against the vault's accepted checkpoint when the node kept it, else its newest. */
export interface EntitlementProof extends ClaimStanding {
  /** The seq of the last command applied when the root was computed, which a claim names; it works once the vault's `latestSeq` has reached it. */
  seq: number;
  /** The root the proof was taken against. */
  root: string;
  account: Address;
  /** The account's cumulative entitlement in MONKEY base units. */
  entitled: string;
  /** Sibling hashes from the root down to the entitlement's leaf. */
  siblings: string[];
}
