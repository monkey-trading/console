/**
 * What a claim card may say while the node holds no proof for the account (monkey-trading/console#260).
 * A proof exists only once the vault has accepted a checkpoint covering the close, which can be
 * minutes after the close, so "no proof yet" says nothing about whether anything was paid: the
 * card says what the page knows, and nothing it does not.
 */

import { carryAccrued } from "../engine/claim-standing";
import type { EntitlementProof } from "../engine/emissions";
import type { StakingPosition } from "../engine/staking";
import type { ActivityPage, MonkeyView } from "../engine/stats-types";
import type { DistributionProof } from "../engine/stats-types";
import type { Read } from "./figures";
import type { ConsoleStore } from "../store/store";

/** `none`: nothing is known to be owed; `reading`: a read that decides it has not landed; `awaiting`: an epoch or period paid that the account may share in, whose proof is not there yet. */
export type Pending<T> = { kind: "none" } | { kind: "reading" } | ({ kind: "awaiting" } & T);

/** The last epoch that paid stakers, with the account's estimated share of it. */
export interface PendingDistribution {
  epoch: number;
  /** What the epoch paid to all stakers, in USDC base units. */
  paid: bigint;
  /** The account's share, estimated from its stake now against the counted total; null where either is unknown. */
  share: bigint | null;
  /** Whether the account stakes: null where its stake cannot be read (a watched account). */
  staker: boolean | null;
}

const UNITS = /^\d+$/;

/**
 * Where the USDC distribution stands for an account with no proof: awaiting once an epoch has paid
 * and the account stakes (or its stake cannot be told), `none` for an account that stakes nothing
 * or when no epoch has paid, and `reading` until the totals and the account's stake have landed.
 */
export function pendingDistribution(overview: Read<MonkeyView>, position: Read<StakingPosition>, unmirroredTotal: string | null): Pending<PendingDistribution> {
  const view = overview.value;
  if (view === null) return { kind: overview.status === "unavailable" ? "none" : "reading" };
  const last = view.distribution?.last_distribution ?? null;
  if (last === null || !UNITS.test(last.allocated_usdc_units) || BigInt(last.allocated_usdc_units) === 0n) return { kind: "none" };
  const paid = BigInt(last.allocated_usdc_units);
  const held = position.value;
  if (held === null) {
    if (position.status === "unavailable") return { kind: "awaiting", epoch: last.epoch, paid, share: null, staker: null };
    return { kind: "reading" };
  }
  if (!held.stakingEnabled || held.staked === 0n) return { kind: "none" };
  const total = view.staking !== null && UNITS.test(view.staking.total_staked) ? BigInt(view.staking.total_staked) : 0n;
  // The node mirrors a stake or an unstake a little after the chain, so until its total moves the two disagree and a share would be wrong.
  const share = total === 0n || unmirroredTotal !== null ? null : (paid * (held.staked > total ? total : held.staked)) / total;
  return { kind: "awaiting", epoch: last.epoch, paid, share, staker: true };
}

/** A closed emission period in which the account realised a loss. */
export interface PendingEmission {
  period: number;
}

/**
 * Where the MONKEY emissions stand for an account with no proof: awaiting when the public feed
 * holds a loss the account closed in an emission period that has since closed.
 */
export function pendingEmission(activity: Read<ActivityPage>, overview: Read<MonkeyView>, account: string): Pending<PendingEmission> {
  const entries = activity.value?.entries;
  const current = overview.value?.emissions?.period ?? null;
  if (entries === undefined || overview.value === null) {
    return { kind: activity.status === "unavailable" || overview.status === "unavailable" ? "none" : "reading" };
  }
  if (current === null) return { kind: "none" };
  const mine = account.toLowerCase();
  let latest: number | null = null;
  for (const entry of entries) {
    if (entry.type !== "loss_close" || entry.period === null || entry.period >= current || entry.account.toLowerCase() !== mine) continue;
    if (latest === null || entry.period > latest) latest = entry.period;
  }
  return latest === null ? { kind: "none" } : { kind: "awaiting", period: latest };
}

/** What the page holds that decides whether a proof is awaited. */
export interface ProofReads {
  overview: Read<MonkeyView>;
  activity: Read<ActivityPage>;
  position: Read<StakingPosition>;
  proof: Read<DistributionProof | null>;
  entitlement: EntitlementProof | null;
  unmirroredTotal: string | null;
  account: string;
}

/** Whether either claim card says a proof is awaited, so the page reads proofs on a short pace and on each checkpoint until one exists. */
export function proofAwaited(reads: ProofReads): boolean {
  const distribution = reads.proof.status === "ready" && reads.proof.value === null && pendingDistribution(reads.overview, reads.position, reads.unmirroredTotal).kind === "awaiting";
  return distribution || (reads.entitlement === null && pendingEmission(reads.activity, reads.overview, reads.account).kind === "awaiting");
}

/** Reads the connected account's MONKEY entitlement proof into the store, as the account read does, while `open` holds and the wallet is still the one asked for; a failure leaves the card saying what it knew, and the next tick asks again. */
export async function readEntitlement(store: ConsoleStore, open: () => boolean): Promise<void> {
  const address = store.liveWallet?.address;
  if (address === undefined) return;
  try {
    const proof = await store.deps.client.emissions(address);
    if (open() && store.liveWallet?.address === address && proof !== null) store.patch({ entitlement: carryAccrued(store.getSnapshot().entitlement, proof) });
  } catch {
    // Not a verdict: the card keeps what it knew.
  }
}
