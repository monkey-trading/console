/** What the exit panel says, from the store's state: its lines in plain words, what it offers, and the one line every page shows when something needs the trader. */

import type { ExitRecord } from "../engine/exit-file";
import { claimWindowEnd, exitPhase, provenTotal, refundSteps, registeredTotal, registerSteps } from "../engine/exit-steps";
import type { ExitClaimFacts, ExitPhase, ExitStep } from "../engine/exit-types";
import { groupThousands, shortHex } from "../format";
import { formatSpan, formatStamp } from "../time";
import { formatUsdc, USDC_UNIT } from "../vault";
import { acceptedRecord, readingProof, type ExitAttempt, type ExitState } from "./exit-state";

/** How long the account may be without a proof at the vault's latest root before every page says so, in chain seconds. */
const STALE_NOTICE_SECONDS = 3_600;
/** How many reads of the vault may fail in a row before every page says so: they are made again by themselves, so this is about three minutes of them failing. */
const FAILURES_NOTICED = 5;

export type ExitTone = "calm" | "warn" | "bad";

export interface ExitLine {
  tone: ExitTone;
  text: string;
}

export interface ExitView {
  phase: ExitPhase;
  lines: ExitLine[];
  /** Whether a file can be imported: it takes a wallet that reads the vault. */
  canImport: boolean;
  /** The offline builder's command for the vault's latest checkpoint, when the saved proof is no use against it. */
  rebuild: string | null;
  canStart: boolean;
  /** What is left to register, in order. */
  register: ExitStep[];
  refunds: Extract<ExitStep, { kind: "refund" | "refund-unheld" }>[];
  /** What the vault holds registered and unpaid, in USDC base units; null before it is read. */
  registered: bigint | null;
  /** Whether the vault would pay a claim now. */
  canClaim: boolean;
  /** When registration closes, in chain seconds; null before the exit starts. */
  windowEnd: number | null;
  /** What every page says, or null when nothing needs the trader. */
  notice: ExitLine | null;
}

const usdc = (units: bigint): string => formatUsdc(units * USDC_UNIT);
/** A reason as the end of a sentence of ours: a wallet's or the browser's may bring its own full stop. */
export const clause = (reason: string): string => reason.replace(/[.\s]+$/, "");
const stamp = (seconds: number): string => `${formatStamp(seconds * 1000)} UTC`;
const spanOf = (seconds: number): string => formatSpan(seconds * 1000);

/** Why the proof is not at the vault's latest root, as a sentence; once the exit has started, the vault takes no further checkpoint to wait for. */
function attemptLine(attempt: ExitAttempt, started: boolean): ExitLine {
  const again = started ? "The vault takes no more checkpoints now." : "It is read again at the vault's next checkpoint.";
  switch (attempt.kind) {
    case "node-ahead": return { tone: "warn", text: `The node's answer was for checkpoint ${groupThousands(attempt.nodeSeq)}, which the vault does not hold. ${again}` };
    case "node-behind": return { tone: "calm", text: `The node is behind the vault: its newest checkpoint is ${groupThousands(attempt.nodeSeq)}. It is read again by itself.` };
    case "no-proof": return { tone: "calm", text: `The node has no proof to give yet. ${again}` };
    case "not-covered": return { tone: "calm", text: started ? "The vault's final checkpoint is older than what this account holds now, so it holds none of it. A deposit it does not hold is refunded below." : "The vault's latest checkpoint is older than what this account holds now, so the next one brings its proof." };
    case "node-failed": return { tone: "calm", text: `The node's proof could not be read: ${clause(attempt.reason)}. It is read again by itself.` };
    case "node-away": return { tone: "warn", text: `The node cannot be read now: ${clause(attempt.reason)}.` };
    case "refused": return { tone: "bad", text: `The node's proof did not pass the vault's check, so it was not saved: ${clause(attempt.reason)}.` };
    case "saved-refused": return { tone: "bad", text: `The proof saved in this browser did not pass the vault's check, so it was removed: ${clause(attempt.reason)}.` };
    case "wallet-failed": return { tone: "calm", text: `Your wallet could not check the proof: ${clause(attempt.reason)}. It is checked again by itself.` };
    default: return attempt satisfies never;
  }
}

/**
 * What a saved proof comes to, as a sentence with its leading space: a pending deposit is refunded
 * rather than claimed, so it does not add to the rest. Registering an approval spends its nonce as
 * paying it does, so once the vault holds a registration its own record is the figure, and the proof
 * gives none to set against it.
 */
function provesLine(held: ExitRecord, claims: ExitClaimFacts | null): string {
  const record = { ...held, paidApprovals: [...held.paidApprovals, ...(claims?.approvalsUsed ?? [])] };
  const registered = claims !== null && (registeredTotal(claims) > 0n || claims.accountRegistered || claims.distributionRegistered || claims.queuedRegistered.length > 0);
  const total = registered ? 0n : provenTotal(record);
  const pending = record.proof.pending_deposits.filter(({ deposit }) => claims?.refunded.includes(deposit.deposit_id) !== true && claims?.mismatched.includes(deposit.deposit_id) !== true).length;
  const deposits = pending === 1 ? "a deposit still pending" : `${pending} deposits still pending`;
  if (pending !== 0) return total === 0n ? ` It proves ${deposits}.` : ` It proves ${usdc(total)}, and ${deposits}.`;
  if (registered) return "";
  return total === 0n ? " It has nothing left to claim." : ` It proves ${usdc(total)}.`;
}

const NOTHING: ExitView = { phase: "none", lines: [], canImport: false, rebuild: null, canStart: false, register: [], refunds: [], registered: null, canClaim: false, windowEnd: null, notice: null };

/** What the panel says of pending deposits the vault's record disagrees with, which its refund would revert on. */
function mismatchLine(ids: readonly number[]): ExitLine {
  const one = ids.length === 1;
  return { tone: "warn", text: `${one ? "Deposit" : "Deposits"} ${ids.join(", ")} ${one ? "is" : "are"} not on the vault as this proof says, so the vault would refuse ${one ? "its refund" : "their refunds"}. The proof stays saved.` };
}

/** The one line every page shows for `exit`, or null; the later rules outrank the earlier. */
function noticeOf(exit: ExitState, phase: ExitPhase, current: boolean, canClaim: boolean, allRegistered: boolean): ExitLine | null {
  const { vault, record, attempt, claims } = exit;
  let notice: ExitLine | null = null;
  if (exit.vaultFailures >= FAILURES_NOTICED) notice = { tone: "warn", text: "Your wallet could not read the vault, so your exit proof may be behind." };
  if (exit.claimsFailures >= FAILURES_NOTICED) notice = { tone: "warn", text: "Your wallet could not read what the vault holds for you." };
  if (exit.storageProblem !== null) notice = { tone: "warn", text: "This browser did not keep your exit proof." };
  if (vault === null) return notice;
  const age = record === null ? 0 : vault.chainNow - record.checkpointAt;
  const missingFor = exit.missingSince === null ? 0 : vault.chainNow - exit.missingSince;
  if (record === null && !exit.nothing && vault.hasCheckpoint && missingFor >= STALE_NOTICE_SECONDS) notice = { tone: "warn", text: "This browser holds no exit proof at the vault's latest checkpoint." };
  if (attempt?.kind === "refused" || attempt?.kind === "saved-refused") notice = { tone: "warn", text: "Your exit proof did not pass the vault's check." };
  if (current && acceptedRecord(exit) === null && exit.checkFailures >= FAILURES_NOTICED) notice = { tone: "warn", text: "Your wallet could not check your exit proof against the vault." };
  // Its age alone is no alarm while the keeper has yet to try for a newer one, as on a returning trader's first read.
  if (record !== null && !current && age >= STALE_NOTICE_SECONDS && !exit.nothing && !readingProof(exit) && (attempt !== null || missingFor >= STALE_NOTICE_SECONDS)) notice = { tone: "warn", text: `Your exit proof is ${spanOf(age)} old, behind the vault's latest checkpoint.` };
  // An account known to hold nothing has no part in the exit, so no page interrupts it; the panel still says where the vault stands.
  const windowEnd = vault.exitStartedAt === 0 ? null : claimWindowEnd(vault);
  if (phase === "due" && !exit.nothing) notice = { tone: "warn", text: `No checkpoint has been posted for ${spanOf(vault.chainNow - vault.lastCheckpointAt)}. The vault's exit can start.` };
  if (phase === "open" && windowEnd !== null && !exit.nothing) notice = allRegistered ? { tone: "warn", text: `Your claim is registered. The vault pays it after ${stamp(windowEnd)}.` } : { tone: "bad", text: `The vault's exit has started. Register your claim by ${stamp(windowEnd)}.` };
  if (phase === "closed" && canClaim) notice = { tone: "bad", text: `The vault's claim window has closed. Your registered ${claims === null ? "claim" : usdc(registeredTotal(claims))} can be paid.` };
  return notice;
}

/** What the panel shows for `exit`, for `wallet`: a watched account has no wallet to read the vault with. */
export function exitView(exit: ExitState, wallet: { address: string; readOnly?: boolean } | null): ExitView {
  if (wallet === null) return { ...NOTHING, lines: [{ tone: "calm", text: "Connect a wallet to see your exit proof." }] };
  if (wallet.readOnly === true) return { ...NOTHING, lines: [{ tone: "calm", text: "A read-only account has no wallet to read the vault with, so no exit proof is kept for it." }] };
  const { vault, record, attempt, claims } = exit;
  const extras: ExitLine[] = [];
  if (exit.storageProblem !== null) extras.push({ tone: "bad", text: record !== null ? `This browser did not keep your proof: ${clause(exit.storageProblem)}. Export it now, or it is gone when this page closes.` : `Your proof cannot be saved: ${clause(exit.storageProblem)}.` });
  const base = { ...NOTHING, canImport: true };
  const readTone: ExitTone = exit.vaultFailures >= FAILURES_NOTICED ? "warn" : "calm";
  if (vault === null) {
    const line: ExitLine = exit.vaultProblem === null ? { tone: "calm", text: "Reading the vault…" } : { tone: readTone, text: `Your wallet could not read the vault: ${clause(exit.vaultProblem)}. It is read again by itself.` };
    return { ...base, lines: [line, ...extras], notice: noticeOf(exit, "none", false, false, false) };
  }
  const phase = exitPhase(vault);
  const windowEnd = vault.exitStartedAt === 0 ? null : claimWindowEnd(vault);
  const current = record?.proof.root === vault.latestRoot;
  const accepted = acceptedRecord(exit);
  const registered = claims === null ? null : registeredTotal(claims);
  const age = record === null ? 0 : vault.chainNow - record.checkpointAt;
  const lines: ExitLine[] = [];
  if (phase === "due") lines.push({ tone: "warn", text: `No checkpoint has been posted for ${spanOf(vault.chainNow - vault.lastCheckpointAt)}, so anyone may start the vault's exit. Starting it is permanent: signed withdrawals and checkpoints end, and ${vault.hasCheckpoint ? "claims are paid from the vault's last posted root" : "every deposit is refunded to the address that paid it"}.` });
  if (phase === "open" && windowEnd !== null) lines.push({ tone: "bad", text: `The vault's exit has started. Claims register until ${stamp(windowEnd)}, then the vault pays each one, pro rata if it is short.` });
  if (phase === "closed" && windowEnd !== null) lines.push({ tone: "warn", text: `The vault's claim window closed at ${stamp(windowEnd)}. Registered claims can be paid now, and nothing more can register.` });
  if (!vault.hasCheckpoint) lines.push({ tone: "calm", text: "The vault has no checkpoint yet, so there is nothing to prove against." });
  else if (current) lines.push({ tone: "calm", text: `Saved in this browser: checkpoint ${groupThousands(record.proof.seq)}, posted ${spanOf(age)} ago.${accepted === null ? " Your wallet has not checked it against the vault yet." : provesLine(accepted, claims)}` });
  else if (readingProof(exit)) lines.push({ tone: "calm", text: "Updating your proof to the vault's latest checkpoint…" });
  else if (record !== null) lines.push({ tone: "warn", text: `Your saved proof is from checkpoint ${groupThousands(record.proof.seq)}, posted ${spanOf(age)} ago. The vault's latest is checkpoint ${groupThousands(vault.latestSeq)}, so the vault would refuse a claim from it.` });
  else if (exit.nothing) lines.push({ tone: "calm", text: "Nothing to save: this account holds nothing in the vault." });
  else if (attempt === null) lines.push({ tone: "calm", text: "No proof is saved in this browser yet." });
  else lines.push({ tone: attempt.kind === "node-ahead" || attempt.kind === "node-away" || attempt.kind === "refused" || attempt.kind === "saved-refused" ? "warn" : "calm", text: "No proof is saved in this browser for this account." });
  // A read that failed says so even of an account known to hold nothing: that is what it was reading to check.
  const failedRead = attempt?.kind === "node-failed" || attempt?.kind === "wallet-failed";
  if (!readingProof(exit) && (!exit.nothing || failedRead) && attempt !== null && (!current || attempt.kind === "wallet-failed")) lines.push(attemptLine(attempt, vault.exitStartedAt !== 0));
  if (exit.vaultProblem !== null) lines.push({ tone: readTone, text: `Your wallet could not read the vault just now, so this is from its last read: ${clause(exit.vaultProblem)}. It is read again by itself.` });
  const started = phase === "open" || phase === "closed";
  if (started && accepted !== null && claims !== null && claims.mismatched.length > 0) lines.push(mismatchLine(claims.mismatched));
  const canClaim = phase === "closed" && registered !== null && registered > 0n && !exit.claimed;
  const left = phase === "open" && accepted !== null && claims !== null ? registerSteps(accepted, claims) : [];
  const allRegistered = phase === "open" && accepted !== null && claims !== null && left.length === 0 && registered !== null && registered > 0n;
  return {
    ...base, phase, windowEnd, lines: [...lines, ...extras],
    rebuild: phase !== "none" && vault.hasCheckpoint && !current && !exit.nothing ? `engine exit-proof --log <mirrored log> --seq ${vault.latestSeq} --account ${wallet.address}` : null,
    canStart: phase === "due" && (!vault.hasCheckpoint || exit.terms?.root === vault.latestRoot),
    register: left,
    refunds: started && claims !== null ? refundSteps(accepted, claims) : [],
    registered, canClaim,
    notice: noticeOf(exit, phase, current, canClaim, allRegistered),
  };
}

/** A stable key for a step's row. */
export function stepKey(step: ExitStep): string {
  switch (step.kind) {
    case "start":
    case "account":
    case "distribution":
    case "claim": return step.kind;
    case "approval": return `approval-${step.proof.approval.nonce}`;
    case "queued": return `queued-${step.proof.queued.requested_seq}`;
    case "refund": return `refund-${step.proof.deposit.deposit_id}`;
    case "refund-unheld": return `refund-${step.id}`;
    default: return step satisfies never;
  }
}

/** What a registration step's row says. */
export function stepLabel(step: ExitStep): string {
  switch (step.kind) {
    case "start": return "Start the vault's exit";
    case "account": return `Balance and positions: ${usdc(step.amount)}`;
    case "approval": return `Withdrawal ${step.proof.approval.nonce}: ${usdc(step.amount)}`;
    case "queued": return `Queued withdrawal: ${usdc(step.amount)}`;
    case "distribution": return `Staking distribution: ${usdc(step.amount)}`;
    case "refund": return `Deposit ${step.proof.deposit.deposit_id}: ${usdc(step.amount)} back to ${step.proof.deposit.payer === null ? "its payer" : shortHex(step.proof.deposit.payer)}`;
    case "refund-unheld": return `Deposit ${step.id}: ${usdc(step.amount)} back to your wallet`;
    case "claim": return "Claim from the vault";
    default: return step satisfies never;
  }
}

/** Whether the page leads with the exit: once it can start or has started, it matters more than moving money. */
export const exitUrgent = (exit: ExitState): boolean => exit.vault !== null && exitPhase(exit.vault) !== "none";
