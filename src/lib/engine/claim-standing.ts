/**
 * What a claim answer (a MONKEY entitlement or a USDC distribution proof) says an account has
 * earned. The proof names the checkpoint the vault can check, which can be older than the node's
 * newest, so the earned figure comes from `newest_entitled`, and a node that predates the field
 * gives only the proof's own `entitled`.
 */

import type { ClaimStanding } from "./emissions";

/** The parts of an answer the figures below read. */
interface ClaimAnswer extends ClaimStanding {
  account: string;
  entitled: string;
}

const DECIMAL = /^\d+$/;

/** The account's cumulative amount at the node's newest checkpoint: `newest_entitled`, never below the proof's `entitled`, and that alone from a node without the field. */
export function accruedOf(answer: ClaimAnswer): bigint {
  const proven = BigInt(answer.entitled);
  const newest = answer.newest_entitled !== undefined && DECIMAL.test(answer.newest_entitled) ? BigInt(answer.newest_entitled) : 0n;
  return newest > proven ? newest : proven;
}

/**
 * `next`, with the earned figure of the answer already held for the same account carried over when
 * it is higher: a later answer may name an older checkpoint, and what the account has earned does
 * not fall with it. Its proof fields are `next`'s own.
 */
export function carryAccrued<T extends ClaimAnswer>(held: ClaimAnswer | null | undefined, next: T): T {
  if (held === null || held === undefined || held.account.toLowerCase() !== next.account.toLowerCase()) return next;
  const before = accruedOf(held);
  return before > accruedOf(next) ? { ...next, newest_entitled: before.toString() } : next;
}

/** Where the vault stands against a proof: `unknown` while nothing can say, `waiting` until a claim can land, `posted` once one can. */
export type Checkpoint = "unknown" | "waiting" | "posted";

/**
 * Whether a claim with `proof` can land now. The node's `claimable` decides it, since it states
 * whether the proof is against a checkpoint the vault accepted and a later checkpoint never
 * unsettles that. A node that predates the field gives no answer, and then the proof's `seq`
 * is compared with the vault's latest posted one, `null` while that is unread.
 */
export function checkpointOf(proof: ClaimStanding & { seq: number }, vaultLatestSeq: number | null): Checkpoint {
  if (proof.claimable !== undefined) return proof.claimable ? "posted" : "waiting";
  if (vaultLatestSeq === null) return "unknown";
  return proof.seq <= vaultLatestSeq ? "posted" : "waiting";
}
