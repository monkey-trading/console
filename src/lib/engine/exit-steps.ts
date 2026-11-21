/** Where the vault's exit stands, and the steps a verified proof has left, in the order the vault takes them. */

import { fixedFromWire } from "../fixed";
import { USDC_UNIT } from "../vault";
import { approvalUnits } from "./exit-proof";
import type { ExitRecord } from "./exit-file";
import type { ExitClaimFacts, ExitPhase, ExitProof, ExitStep, ExitTermsProof, VaultExitFacts } from "./exit-types";

/** The vault's own judgement at `facts.chainNow`: `startExit` refuses before `lastCheckpointAt + exitPeriod`, and `_requireClaimWindow` from `exitStartedAt + claimWindow`. */
export function exitPhase(facts: VaultExitFacts): ExitPhase {
  if (facts.exitStartedAt !== 0) return facts.chainNow >= facts.exitStartedAt + facts.claimWindow ? "closed" : "open";
  return facts.chainNow >= facts.lastCheckpointAt + facts.exitPeriod ? "due" : "none";
}

/** When the claim window closes, in chain seconds. */
export const claimWindowEnd = (facts: VaultExitFacts): number => facts.exitStartedAt + facts.claimWindow;

/** What `startExit` takes when the vault has never had a checkpoint: it ignores the terms, and refunds every deposit. */
export const NO_TERMS: ExitTermsProof = { seq: 0, root: `0x${"0".repeat(64)}`, terms: { deposit_cursor: 0, deposit_base: 0, pending: "0", held: "0", unheld: "0", held_receipts: "0", gaps: [] }, siblings: [] };

/** A raw engine amount in whole USDC base units, rounded down, as `registerExitQueued` and a pending deposit's record take it. */
const baseUnits = (amount: string): bigint => fixedFromWire(amount) / USDC_UNIT;

/** A step that refunds a deposit. */
export type RefundStep = Extract<ExitStep, { kind: "refund" | "refund-unheld" | "refund-receipt" }>;

/** The most credits one `registerExitCredits` step carries, so each transaction stays well within a block however many an account holds. */
export const CREDITS_PER_STEP = 32;

/** The registrations `record` has left, as the vault would pay them. A step worth nothing is left out, which would only spend gas: the claim floors at zero. */
export function registerSteps(record: ExitRecord, claims: ExitClaimFacts): ExitStep[] {
  const { proof, accountClaim } = record;
  const steps: ExitStep[] = [];
  // A credit the vault's records do not match, or whose deposit is refunded, adds nothing, so registering it would only spend gas.
  const uncounted = proof.unfinalised_credits.filter(({ deposit }) => ![claims.creditsCounted, claims.creditsUnmatched, claims.refunded].some((ids) => ids.includes(deposit.deposit_id)));
  if (proof.account !== null && accountClaim > 0n && !claims.accountRegistered) steps.push({ kind: "account", proof: proof.account, amount: accountClaim, withCredits: uncounted.length > 0 });
  // The credits follow the account's equity, and are worth sending while the claim previewed holds more than it has come to so far.
  if (proof.account !== null && uncounted.length > 0 && accountClaim > claims.accountClaimed) {
    const parts = Math.ceil(uncounted.length / CREDITS_PER_STEP);
    const amount = claims.accountRegistered ? accountClaim - claims.accountClaimed : null;
    for (let part = 1; part <= parts; part++) steps.push({ kind: "credits", account: proof.account.account, proofs: uncounted.slice((part - 1) * CREDITS_PER_STEP, part * CREDITS_PER_STEP), part, parts, amount: part === 1 ? amount : null });
  }
  for (const held of proof.approvals) {
    if (!claims.approvalsUsed.includes(held.approval.nonce)) steps.push({ kind: "approval", proof: held, amount: approvalUnits(held.approval.amount) ?? 0n });
  }
  for (const held of proof.queued) {
    const amount = baseUnits(held.queued.remaining);
    if (amount > 0n && !claims.queuedRegistered.includes(held.queued.requested_seq)) steps.push({ kind: "queued", proof: held, amount });
  }
  if (proof.distribution !== null && !claims.distributionRegistered) {
    // As `registerExitDistribution` takes it: what the root entitles the account to, less what the vault has paid by now.
    const amount = BigInt(proof.distribution.entitled) - claims.distributionPaid;
    if (amount > 0n) steps.push({ kind: "distribution", proof: proof.distribution, amount });
  }
  return steps;
}

/**
 * The deposits that can still be refunded, to the address that paid each, after the exit starts:
 * those a proof at the exit's root holds pending and the vault's record agrees with, null with no
 * such proof, those the root does not hold, which need none, and, while claims register, this
 * account's own at ids whose receipt in the root the vault's records do not match.
 */
export function refundSteps(record: ExitRecord | null, claims: ExitClaimFacts): RefundStep[] {
  const pending = (record?.proof.pending_deposits ?? [])
    .filter((held) => !claims.refunded.includes(held.deposit.deposit_id) && !claims.mismatched.includes(held.deposit.deposit_id))
    .map((held) => ({ kind: "refund" as const, proof: held, amount: baseUnits(held.deposit.amount) }));
  const receipts = record === null ? [] : claims.receiptRefunds.map((held) => ({ kind: "refund-receipt" as const, ...held }));
  return [...pending, ...claims.unheld.map(({ id, amount }) => ({ kind: "refund-unheld" as const, id, amount })), ...receipts];
}

/** Whether `saved` holds a part `candidate` does not: the verifier proves only the parts a file carries, so a trimmed file at the same root would prove too. */
export function holdsLess(candidate: ExitProof, saved: ExitProof): boolean {
  return (saved.account !== null && candidate.account === null)
    || (saved.distribution !== null && candidate.distribution === null)
    || saved.approvals.some((held) => !candidate.approvals.some((other) => other.approval.nonce === held.approval.nonce))
    || saved.queued.some((held) => !candidate.queued.some((other) => other.queued.requested_seq === held.queued.requested_seq))
    || saved.pending_deposits.some((held) => !candidate.pending_deposits.some((other) => other.deposit.deposit_id === held.deposit.deposit_id))
    || saved.unfinalised_credits.some((held) => !candidate.unfinalised_credits.some((other) => other.deposit.deposit_id === held.deposit.deposit_id));
}

/** What is registered and unpaid, in USDC base units. */
export const registeredTotal = (claims: ExitClaimFacts): bigint => claims.exitClaim + claims.exitDistributionClaim;

/** What the proof's registrations come to, in USDC base units: its value before the vault's pro rata, whichever are already registered. */
export function provenTotal(record: ExitRecord): bigint {
  const { proof, accountClaim, distributionOwed, paidApprovals } = record;
  const approvals = proof.approvals.filter((held) => !paidApprovals.includes(held.approval.nonce)).reduce((sum, held) => sum + (approvalUnits(held.approval.amount) ?? 0n), 0n);
  const queued = proof.queued.reduce((sum, held) => sum + baseUnits(held.queued.remaining), 0n);
  return accountClaim + approvals + queued + distributionOwed;
}
