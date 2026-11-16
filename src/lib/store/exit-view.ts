/** What the exit panel says, from the store's state: its lines in plain words, what it offers, and the one line every page shows when something needs the trader. */

import type { ExitRecord } from "../engine/exit-file";
import { claimWindowEnd, exitPhase, provenTotal, refundSteps, registeredTotal, registerSteps } from "../engine/exit-steps";
import type { ExitClaimFacts, ExitPhase, ExitStep } from "../engine/exit-types";
import { groupThousands, shortHex } from "../format";
import { formatSpanWords, formatStamp } from "../time";
import { formatUsdc, USDC_UNIT } from "../vault";
import { acceptedRecord, behindLasts, BEHIND_NOTICE_SECONDS, type ExitAttempt, type ExitState } from "./exit-state";

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
const spanOf = (seconds: number): string => formatSpanWords(seconds * 1000);

/** Why the proof is not at the vault's latest root, as a sentence; once the exit has started, the vault takes no further checkpoint to wait for. */
function attemptLine(attempt: ExitAttempt, started: boolean): ExitLine {
  const again = started ? "The vault no longer accepts new snapshots." : "The app will request the proof again at the vault's next snapshot.";
  switch (attempt.kind) {
    case "node-ahead": return { tone: "warn", text: `The server's proof is for snapshot ${groupThousands(attempt.nodeSeq)}, which the vault has not yet received. ${started ? again : "The proof is held and will be saved once the vault receives that snapshot."}` };
    case "node-behind": return { tone: "calm", text: `The server is behind the vault, as its newest snapshot is ${groupThousands(attempt.nodeSeq)}. The app will try again automatically.` };
    case "no-proof": return { tone: "calm", text: `The server does not yet have a proof for your account. ${again}` };
    case "not-covered": return { tone: "calm", text: started ? "The vault's final snapshot predates this account's current holdings, so it does not include any of them. Any deposit that the snapshot does not include can be refunded below." : "The vault's latest snapshot predates this account's current holdings, so the proof will be available with the next snapshot." };
    case "node-failed": return { tone: "calm", text: `The proof could not be obtained from the server: ${clause(attempt.reason)}. The app will try again automatically.` };
    case "node-away": return { tone: "warn", text: `A proof cannot be obtained from the server at the moment: ${clause(attempt.reason)}.` };
    case "refused": return { tone: "bad", text: `The server's proof failed the vault's check, so it was not saved: ${clause(attempt.reason)}.` };
    case "saved-refused": return { tone: "bad", text: `The proof saved in this browser failed the vault's check, so it was removed: ${clause(attempt.reason)}.` };
    case "wallet-failed": return { tone: "calm", text: `Your wallet could not check the proof: ${clause(attempt.reason)}. The app will try again automatically.` };
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
  if (pending !== 0) return total === 0n ? ` The proof covers ${deposits}.` : ` The proof covers ${usdc(total)} and ${deposits}.`;
  if (registered) return "";
  return total === 0n ? " The proof has nothing left to claim." : ` The proof covers ${usdc(total)}.`;
}

/** What the exit leaves the account, for the notice. */
interface Standing {
  canClaim: boolean;
  allRegistered: boolean;
  /** The proof is current, the vault's record has been read, nothing is left to register and nothing is registered. */
  nothingToRegister: boolean;
  /** How many deposits can be refunded. */
  refunds: number;
}

const NO_STANDING: Standing = { canClaim: false, allRegistered: false, nothingToRegister: false, refunds: 0 };

const NOTHING: ExitView = { phase: "none", lines: [], canImport: false, rebuild: null, canStart: false, register: [], refunds: [], registered: null, canClaim: false, windowEnd: null, notice: null };

/** What follows a saved proof's line: what this connection's verifier accepted it to hold, which stands while the vault moves on, or that it has yet to judge one at the vault's latest root. */
function savedFigures(exit: ExitState, record: ExitRecord, current: boolean): string {
  if (exit.checked === record) return provesLine(record, exit.claims);
  return current ? " Your wallet has not yet checked the proof against the vault." : "";
}

/** What the panel says of an account known to hold nothing the node shows, with `unheld` deposits on the vault that need no proof. */
function nothingLine(unheld: number): string {
  if (unheld === 0) return "There is no proof to save, because this account holds nothing in the vault.";
  return `There is no proof to save, because this account's only holding in the vault is the ${unheld === 1 ? "deposit below, which needs" : "deposits below, which need"} no proof.`;
}

/** What the panel says of pending deposits the vault's record disagrees with, which its refund would revert on. */
function mismatchLine(ids: readonly number[]): ExitLine {
  const one = ids.length === 1;
  return { tone: "warn", text: `${one ? "Deposit" : "Deposits"} ${ids.join(", ")} ${one ? "does" : "do"} not match the vault's record, so the vault would refuse ${one ? "its refund" : "their refunds"}. The proof remains saved.` };
}

/** Whether the browser's storage has nothing to keep for the account: one known to hold nothing, with no proof in the page. */
const nothingToKeep = (exit: Pick<ExitState, "nothing" | "record">): boolean => exit.nothing && exit.record === null;

/** The one line every page shows for `exit`, or null; the later rules outrank the earlier. */
function noticeOf(exit: ExitState, phase: ExitPhase, current: boolean, standing: Standing): ExitLine | null {
  const { vault, record, attempt, claims } = exit;
  const { canClaim, allRegistered, nothingToRegister, refunds } = standing;
  let notice: ExitLine | null = null;
  if (exit.vaultFailures >= FAILURES_NOTICED) notice = { tone: "warn", text: "Your wallet could not reach the vault, so your exit proof may be out of date." };
  if (exit.claimsFailures >= FAILURES_NOTICED) notice = { tone: "warn", text: "Your wallet could not check what the vault holds for you." };
  if (exit.storageProblem !== null && !nothingToKeep(exit)) notice = { tone: "warn", text: "This browser did not save your exit proof." };
  if (vault === null) return notice;
  const age = record === null ? 0 : vault.chainNow - record.checkpointAt;
  const missingFor = exit.missingSince === null ? 0 : vault.chainNow - exit.missingSince;
  if (record === null && !exit.nothing && vault.hasCheckpoint && missingFor >= BEHIND_NOTICE_SECONDS) notice = { tone: "warn", text: "This browser has no exit proof for the vault's latest snapshot." };
  if (attempt?.kind === "refused" || attempt?.kind === "saved-refused") notice = { tone: "warn", text: "Your exit proof failed the vault's check." };
  if (current && acceptedRecord(exit) === null && exit.checkFailures >= FAILURES_NOTICED) notice = { tone: "warn", text: "Your wallet could not check your exit proof against the vault." };
  // Its age alone is no alarm: the first checkpoint after a quiet spell leaves an old proof behind for only as long as the next read takes.
  if (record !== null && !current && age >= BEHIND_NOTICE_SECONDS && !exit.nothing && behindLasts(exit)) notice = { tone: "warn", text: `Your exit proof is ${spanOf(age)} old and does not reflect the vault's latest snapshot.` };
  // An account known to hold nothing has no part in the exit, so no page interrupts it; the panel still says where the vault stands.
  const windowEnd = vault.exitStartedAt === 0 ? null : claimWindowEnd(vault);
  if (phase === "due" && !exit.nothing) notice = { tone: "warn", text: `The server has not posted a snapshot for ${spanOf(vault.chainNow - vault.lastCheckpointAt)}, so the vault's exit can now be started.` };
  const refundable: ExitLine | null = refunds === 0 ? null : { tone: "warn", text: refunds === 1 ? "The vault can refund one of your deposits." : `The vault can refund ${refunds} of your deposits.` };
  if (phase === "open" && windowEnd !== null) {
    if (exit.nothing || nothingToRegister) notice = refundable ?? notice;
    else notice = allRegistered ? { tone: "warn", text: `Your claim is registered, and the vault will pay it after ${stamp(windowEnd)}.` } : { tone: "bad", text: `The vault's exit has started. Register your claim by ${stamp(windowEnd)}.` };
  }
  if (phase === "closed") notice = canClaim ? { tone: "bad", text: `The vault's claim window has closed. You can now collect your registered ${claims === null ? "claim" : usdc(registeredTotal(claims))}.` } : refundable ?? notice;
  return notice;
}

/** What the panel shows for `exit`, for `wallet`: a watched account has no wallet to read the vault with. */
export function exitView(exit: ExitState, wallet: { address: string; readOnly?: boolean } | null): ExitView {
  if (wallet === null) return { ...NOTHING, lines: [{ tone: "calm", text: "Connect a wallet to see your exit proof." }] };
  if (wallet.readOnly === true) return { ...NOTHING, lines: [{ tone: "calm", text: "No exit proof is kept for an account viewed in read-only mode, because there is no wallet with which to check the vault." }] };
  const { vault, record, attempt, claims } = exit;
  const extras: ExitLine[] = [];
  if (exit.storageProblem !== null && !nothingToKeep(exit)) extras.push({ tone: "bad", text: record !== null ? `This browser did not save your proof: ${clause(exit.storageProblem)}. Export the proof now, or it will be lost when you close this page.` : `Your proof cannot be saved: ${clause(exit.storageProblem)}.` });
  const base = { ...NOTHING, canImport: true };
  const readTone: ExitTone = exit.vaultFailures >= FAILURES_NOTICED ? "warn" : "calm";
  if (vault === null) {
    const line: ExitLine = exit.vaultProblem === null ? { tone: "calm", text: "Checking the vault…" } : { tone: readTone, text: `Your wallet could not reach the vault: ${clause(exit.vaultProblem)}. The app will try again automatically.` };
    return { ...base, lines: [line, ...extras], notice: noticeOf(exit, "none", false, NO_STANDING) };
  }
  const phase = exitPhase(vault);
  const windowEnd = vault.exitStartedAt === 0 ? null : claimWindowEnd(vault);
  const current = record?.proof.root === vault.latestRoot;
  const accepted = acceptedRecord(exit);
  const registered = claims === null ? null : registeredTotal(claims);
  const age = record === null ? 0 : vault.chainNow - record.checkpointAt;
  // A checkpoint or two behind is the ordinary gap while they keep arriving, and says nothing of the proof; it matters once it lasts, or once the vault takes no more.
  const warnBehind = phase !== "none" || behindLasts(exit);
  const lines: ExitLine[] = [];
  if (phase === "due") lines.push({ tone: "warn", text: `The server has not posted a snapshot for ${spanOf(vault.chainNow - vault.lastCheckpointAt)}, so anyone can now start the vault's exit. Starting the exit is permanent: normal withdrawals and snapshots stop, and ${vault.hasCheckpoint ? "claims are paid on the basis of the vault's last snapshot" : "every deposit is refunded to the address that paid it"}.` });
  if (phase === "open" && windowEnd !== null) lines.push({ tone: "bad", text: `The vault's exit has started, and you can register claims until ${stamp(windowEnd)}. After that time the vault pays each registered claim, sharing its funds in proportion if it cannot pay every claim in full.` });
  if (phase === "closed" && windowEnd !== null) lines.push({ tone: "warn", text: `The vault's claim window closed at ${stamp(windowEnd)}. Registered claims can be paid now, and no new claims can be registered.` });
  if (!vault.hasCheckpoint) lines.push({ tone: "calm", text: "The vault has no snapshot yet, so there is nothing against which to check a proof." });
  else if (exit.importing && !current) lines.push({ tone: "calm", text: "Updating your proof to the vault's latest snapshot…" });
  else if (record !== null) {
    if (current || !warnBehind) lines.push({ tone: "calm", text: `A proof for snapshot ${groupThousands(record.proof.seq)}, posted ${spanOf(age)} ago, is saved in this browser.${savedFigures(exit, record, current)}` });
    else lines.push({ tone: "warn", text: `Your saved proof is for snapshot ${groupThousands(record.proof.seq)}, posted ${spanOf(age)} ago. ${phase === "none" ? `The proof has been behind the vault's latest snapshot, ${groupThousands(vault.latestSeq)}, for more than ${spanOf(BEHIND_NOTICE_SECONDS)}, so the vault would refuse a claim based on it if the server stopped now.` : `The vault's latest snapshot is ${groupThousands(vault.latestSeq)}, so the vault would refuse a claim based on the saved proof.`}` });
  } else if (exit.nothing) lines.push({ tone: "calm", text: nothingLine(claims?.unheld.length ?? 0) });
  else if (attempt === null || (attempt.kind === "node-ahead" && !warnBehind)) lines.push({ tone: "calm", text: "No proof is saved in this browser yet." });
  else lines.push({ tone: attempt.kind === "node-ahead" || attempt.kind === "node-away" || attempt.kind === "refused" || attempt.kind === "saved-refused" ? "warn" : "calm", text: "No proof is saved in this browser for this account." });
  // A read that failed says so even of an account known to hold nothing: that is what it was reading to check.
  const failedRead = attempt?.kind === "node-failed" || attempt?.kind === "wallet-failed";
  if (!exit.reading && !exit.importing && (!exit.nothing || failedRead) && attempt !== null && (!current || attempt.kind === "wallet-failed") && (attempt.kind !== "node-ahead" || warnBehind)) lines.push(attemptLine(attempt, vault.exitStartedAt !== 0));
  if (exit.vaultProblem !== null) lines.push({ tone: readTone, text: `Your wallet could not reach the vault just now (${clause(exit.vaultProblem)}), so the figures shown are from the last successful check. The app will try again automatically.` });
  const started = phase === "open" || phase === "closed";
  if (started && accepted !== null && claims !== null && claims.mismatched.length > 0) lines.push(mismatchLine(claims.mismatched));
  // `Vault._settle` fills client claims first, and distribution claims from what is left.
  if (started && ((accepted?.distributionOwed ?? 0n) > 0n || (claims?.exitDistributionClaim ?? 0n) > 0n)) lines.push({ tone: "calm", text: "Staking distributions are paid only from the funds that remain after client claims have been paid." });
  const canClaim = phase === "closed" && registered !== null && registered > 0n && !exit.claimed;
  const left = phase === "open" && accepted !== null && claims !== null ? registerSteps(accepted, claims) : [];
  const allRegistered = phase === "open" && accepted !== null && claims !== null && left.length === 0 && registered !== null && registered > 0n;
  const nothingToRegister = phase === "open" && accepted !== null && claims !== null && left.length === 0 && registered === 0n;
  const refunds = started && claims !== null ? refundSteps(accepted, claims) : [];
  return {
    ...base, phase, windowEnd, lines: [...lines, ...extras],
    rebuild: phase !== "none" && vault.hasCheckpoint && !current && !exit.nothing ? `engine exit-proof --log <mirrored log> --seq ${vault.latestSeq} --account ${wallet.address}` : null,
    canStart: phase === "due" && (!vault.hasCheckpoint || exit.terms?.root === vault.latestRoot),
    register: left,
    refunds,
    registered, canClaim,
    notice: noticeOf(exit, phase, current, { canClaim, allRegistered, nothingToRegister, refunds: refunds.length }),
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
    case "refund": return `Deposit ${step.proof.deposit.deposit_id}: ${usdc(step.amount)} refunded to ${step.proof.deposit.payer === null ? "the address that paid it" : shortHex(step.proof.deposit.payer)}`;
    case "refund-unheld": return `Deposit ${step.id}: ${usdc(step.amount)} refunded to your wallet`;
    case "claim": return "Claim from the vault";
    default: return step satisfies never;
  }
}

/** Whether the page leads with the exit: once it can start or has started, it matters more than moving money. */
export const exitUrgent = (exit: ExitState): boolean => exit.vault !== null && exitPhase(exit.vault) !== "none";
