/**
 * MONKEY emissions as the node serves them: the account's cumulative entitlement with its proof,
 * field for field as `engine_core::merkle::EntitlementProof` serializes. `entitled` counts MONKEY
 * base units (18 decimals), not the engine's nine-place `Fixed`, so it stays a decimal string here
 * and a bigint in the store.
 */

import type { Address } from "./types";

/** `GET /v1/accounts/{address}/emissions`: the proof the vault's `claimEmissions` takes, against the root of the node's last posted checkpoint. */
export interface EntitlementProof {
  /** The seq of the last command applied when the root was computed; the claim works once the vault's `latestSeq` reaches it. */
  seq: number;
  /** The root the proof was taken against. */
  root: string;
  account: Address;
  /** The account's cumulative entitlement in MONKEY base units. */
  entitled: string;
  /** Sibling hashes from the root down to the entitlement's leaf. */
  siblings: string[];
}
