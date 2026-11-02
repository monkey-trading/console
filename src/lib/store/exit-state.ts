/** What the console holds about the account's way out through the vault, and what it can tell without asking the node. */

import type { ExitRecord } from "../engine/exit-file";
import type { ExitClaimFacts, ExitTermsProof, VaultExitFacts } from "../engine/exit-types";
import { readBlock, type AttestationStatus, type FeedStatus } from "../engine/attestation";
import { USDC_UNIT } from "../vault";
import type { ConsoleState } from "./state";

/** What taking a proof came to. */
export type AdoptOutcome =
  | { kind: "saved"; record: ExitRecord; storageProblem: string | null }
  /** It proves, and gives the account nothing. */
  | { kind: "empty" }
  /** It proves, and holds a part the proof saved at its root holds and it does not, so it was not saved. */
  | { kind: "holds-less" }
  /** Its root is not the vault's latest, or another tab has saved a later one. */
  | { kind: "other-root"; proofSeq: number; vaultSeq: number }
  | { kind: "refused"; reason: string };

/** Why the saved proof is not at the vault's latest root, when something was tried. */
export type ExitAttempt =
  /** The node answered at another root than the vault holds: it stays until the vault's next checkpoint. */
  | { kind: "node-ahead"; nodeSeq: number }
  /** The node's newest checkpoint is older than the vault's latest, as on a restarted or elected node: it is read again at each read of the vault until it has caught up. */
  | { kind: "node-behind"; nodeSeq: number }
  /** The node has no proof yet: its first checkpoint under the exit's protocol has not been made. */
  | { kind: "no-proof" }
  /** The read of the node failed. */
  | { kind: "node-failed"; reason: string }
  /** The node cannot be read now: it is not verified, or its feed has stopped. */
  | { kind: "node-away"; reason: string }
  /** The vault's latest root predates what the account holds now, so its answer held none of it: the next checkpoint covers it. */
  | { kind: "not-covered" }
  /** The vault's verifier refused what the node sent, or it did not read as a proof. */
  | { kind: "refused"; reason: string }
  /** The vault's verifier refused the proof this browser had saved, so it was removed. */
  | { kind: "saved-refused"; reason: string }
  /** The wallet could not check what the node sent, so it was not kept. */
  | { kind: "wallet-failed"; reason: string };

/** What an import or action came to, for the `exit` notice surface: a failure, or something the screen does not show by itself. Null says nothing. */
export type ExitResult = { ok: boolean; text: string } | null;

export interface ExitState {
  /** The vault's last read; null before one answers. */
  vault: VaultExitFacts | null;
  /** Why the last read of the vault failed; null once one answers. */
  vaultProblem: string | null;
  /** How many reads of the vault have failed in a row. */
  vaultFailures: number;
  /** When this account is known to have been without a proof at the vault's latest root and no sign it has nothing, in chain seconds; null otherwise. */
  missingSince: number | null;
  /** The last proof the vault's verifier accepted, in this connection or when it was saved, whether it is still the vault's latest or not. */
  record: ExitRecord | null;
  /** The record the vault's verifier has accepted in this connection, which storage alone does not vouch for. */
  checked: ExitRecord | null;
  /** How many checks of the saved proof have failed in a row since one last answered. */
  checkFailures: number;
  /** The exit terms of the last proof the verifier accepted, which start the exit even from a proof that gives this account nothing. */
  terms: ExitTermsProof | null;
  /** Why the proof could not be saved in, or read from, this browser; `record` then holds the one in this page, if any. */
  storageProblem: string | null;
  /** Why `record` is not at the vault's latest root; null when nothing failed. */
  attempt: ExitAttempt | null;
  /** Whether the node's proof is being read or checked now. */
  reading: boolean;
  /** Whether a file the trader chose is being read or checked now. */
  importing: boolean;
  /** Whether the account is known to have nothing at stake, so nothing is read for it. */
  nothing: boolean;
  /** What the vault holds for `record` once its exit has started; null before that read answers. */
  claims: ExitClaimFacts | null;
  /** Why that read failed. */
  claimsProblem: string | null;
  /** How many reads of it have failed in a row. */
  claimsFailures: number;
  /** The USDC base units the vault paid this page's claim, null too when its receipt did not show them. */
  paid: bigint | null;
  /** Whether this page's claim was mined: nothing is left to claim, whatever the vault was last read to hold. */
  claimed: boolean;
  /** What a screen reader was last told of a success the panel shows by itself; a failure goes on the `exit` notice surface. */
  announced: string;
}

/** The state for a connection nothing has been read for. */
export const NO_EXIT: ExitState = { vault: null, vaultProblem: null, vaultFailures: 0, missingSince: null, record: null, checked: null, checkFailures: 0, terms: null, storageProblem: null, attempt: null, reading: false, importing: false, nothing: false, claims: null, claimsProblem: null, claimsFailures: 0, paid: null, claimed: false, announced: "" };

/** `exit`'s record once this connection's verifier has accepted it at the vault's latest root: only then does anything in it count for a claim, a refund or a figure. */
export function acceptedRecord(exit: Pick<ExitState, "vault" | "record" | "checked">): ExitRecord | null {
  const { vault, record, checked } = exit;
  return record !== null && record === checked && record.proof.root === vault?.latestRoot ? record : null;
}

/** Whether a proof is being read or checked, which a press may not come between: what it comes to is not for the press to replace. */
export const readingProof = (exit: Pick<ExitState, "reading" | "importing">): boolean => exit.reading || exit.importing;

/** Whether a read failed that reading again can mend: of the vault, of what it holds for the account, of the node, or the wallet's check of a proof. */
export const readFailed = (exit: ExitState): boolean => exit.vaultProblem !== null || exit.claimsProblem !== null || exit.attempt?.kind === "node-failed" || exit.attempt?.kind === "wallet-failed";

/** Whether the node can be read for a proof now, should wait, or is away with a reason. */
export function nodeWait(attestation: AttestationStatus, stream: FeedStatus): "ready" | "wait" | { away: string } {
  if (attestation.kind === "checking" || attestation.kind === "reverifying") return "wait";
  const blocked = readBlock(attestation, stream);
  if (blocked === null) return "ready";
  return stream === "connecting" && attestation.kind !== "unverified" && attestation.kind !== "clock" ? "wait" : { away: blocked };
}

/** Whether what the page has read says the account holds something now: a balance, a position or a queued withdrawal. A balance under one USDC base unit does not count: it can be neither withdrawn nor claimed, as `accountClaim` floors it, and a full withdrawal leaves one. */
export function holdsNow(state: Pick<ConsoleState, "account" | "queue">): boolean {
  const { account } = state;
  return (account !== null && (account.balance >= USDC_UNIT || account.unfinalised !== 0n || account.positions.length > 0)) || state.queue.length > 0;
}

/**
 * Whether the node's answer could hold anything for the account, from what the page has read: what it
 * holds now, a withdrawal, a pending deposit, or a saved proof whose contents may still be owed.
 * Without any of those only a stake, which the chain says, could. An answer is the node's signature
 * for nothing otherwise, so this is what spares it; it errs towards a read. A withdrawal the vault
 * shows paid counts too: that read is of the chain's head, which can still undo it, and only the
 * answer's own check at a finalized block says otherwise.
 */
export function mayHold(state: Pick<ConsoleState, "account" | "queue" | "authorizations" | "history" | "approvals">, record: ExitRecord | null): boolean {
  if (holdsNow(state) || record !== null || state.authorizations.length > 0) return true;
  // `queue` is one page of a bounded scan, which can come back empty with the account's request further on, so its event counts too.
  return [...state.history, ...state.approvals].some((event) => event.type === "withdrawal_approved" || event.type === "deposit_pending" || event.type === "withdrawal_queued");
}

/**
 * How far back the page's reads show a funded account going, in seconds, once a read has failed to
 * bring its proof: a trader with short sessions has been without one that long, whatever this page
 * saw. An answer that says the vault's root predates its funds is the next checkpoint's to mend.
 */
export function heldSince(state: Pick<ConsoleState, "account" | "queue" | "history"> & { exit: Pick<ExitState, "attempt"> }): number | null {
  const { attempt } = state.exit;
  const oldest = state.history.at(-1)?.ts;
  if (attempt === null || attempt.kind === "not-covered" || !holdsNow(state) || oldest === undefined) return null;
  return Math.floor(oldest / 1000);
}

/** What changes when the account's stake may have: an answer that found nothing holds until this does. */
export function stakeKey(state: Pick<ConsoleState, "account" | "queue" | "authorizations" | "history">): string {
  const { account } = state;
  return [account?.balance ?? "", account?.unfinalised ?? "", account?.positions.length ?? "", state.queue.length, state.authorizations.length, state.history[0]?.cursor ?? ""].join("|");
}

/** The seq of the account's newest event the page has read; an answer at an older checkpoint says nothing of it. */
export const newestEventSeq = (state: Pick<ConsoleState, "history">): number => Number(state.history[0]?.cursor.split(":")[0] ?? 0);
