/**
 * Where the Staking page's delegation forms choose a candidate from (monkey-trading/console#279). No
 * single operator may stop a staker voting away from it: while the node's list is in hand they choose
 * from it; while it is not, because the node is unverified or its list cannot be read, they choose
 * from the last list verified, or take a typed address that only the chain checks.
 */

import { isAddress } from "viem";

import { readBlock, type AttestationStatus } from "../engine/attestation";
import type { Read } from "../monkey/figures";
import type { OperatorsView } from "./operator-table";

/** An address as the console takes one: `0x` and 40 hexadecimal digits. */
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Why the node's list is not in hand: its answers may not be read now, or they may and its list was not. */
export type NoList = NodeBlocked | "unread";

/** Why the node's answers may not be read now: it is not verified, or the device clock and its signed time disagree. */
export type NodeBlocked = "unverified" | "clock";

/** Why the node's answers may not be read under `attestation`, by the reads' own trust rule (the attestation alone); null while they may. */
export function nodeBlocked(attestation: AttestationStatus): NodeBlocked | null {
  if (readBlock(attestation, "live") === null) return null;
  return attestation.kind === "clock" ? "clock" : "unverified";
}

export type CandidateSource =
  | { kind: "current" }
  /** The node is verified and its first list is on its way. */
  | { kind: "loading" }
  | { kind: "held"; verifiedAtMs: number; block: number; why: NoList }
  | { kind: "none"; why: NoList };

/** The source for the node's list `list`, the last one verified `held`, and why the node's answers may not be read now (`blocked`, null while they may). */
export function candidateSource(list: Read<OperatorsView>, held: { view: OperatorsView; verifiedAtMs: number } | null, blocked: NodeBlocked | null): CandidateSource {
  if (list.status === "ready" && list.value !== null) return { kind: "current" };
  if (blocked === null && list.status === "loading") return { kind: "loading" };
  const why: NoList = blocked ?? "unread";
  return held === null ? { kind: "none", why } : { kind: "held", verifiedAtMs: held.verifiedAtMs, block: held.view.block.number, why };
}

/** Whether a picker offers the address field: off the node's list, and while anything typed stays, so a destination is never swapped under the visitor. */
export function offersTyped(source: CandidateSource, typed: string): boolean {
  return source.kind === "held" || source.kind === "none" || typed.trim() !== "";
}

/** The zero address, which no candidate has: the staking contract refuses it. */
const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Whether typed text is an address a delegation may go to: well formed, its EIP-55 checksum right
 * where it is mixed case (all lower or all upper case carries none), and not the zero address.
 */
export function typedAddressOk(text: string): boolean {
  if (!ADDRESS.test(text) || text.toLowerCase() === ZERO) return false;
  const hex = text.slice(2);
  return hex === hex.toLowerCase() || hex === hex.toUpperCase() || isAddress(text, { strict: true });
}

/**
 * The candidate a picker names: what is typed, lowercased, once it is an address a delegation may go
 * to, else the chosen option (none for ""); null for typed text that is not such an address, or with
 * nothing chosen. What is typed holds when the node's list comes back, until the visitor clears it or
 * chooses a candidate.
 */
export function pickedCandidate(typed: string, value: string | null): string | null {
  const text = typed.trim();
  if (text === "") return value === "" ? null : value;
  return typedAddressOk(text) ? text.toLowerCase() : null;
}
