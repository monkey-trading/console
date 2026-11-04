/**
 * Where the Staking page's delegation forms choose a candidate from (monkey-trading/console#279). No
 * single operator may stop a staker voting away from it: while the node's list is in hand they choose
 * from it; while it is not, because the node is unverified or its list cannot be read, they choose
 * from the last list verified, or take a typed address that only the chain checks.
 */

import type { Read } from "../monkey/figures";
import type { OperatorsView } from "./operator-table";

/** An address as the console takes one: `0x` and 40 hexadecimal digits. */
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Why the node's list is not in hand. */
export type NoList = "unverified" | "unread";

export type CandidateSource =
  | { kind: "current" }
  /** The node is verified and its first list is on its way. */
  | { kind: "loading" }
  | { kind: "held"; verifiedAtMs: number; block: number; why: NoList }
  | { kind: "none"; why: NoList };

/** The source for the node's list `list`, the last one verified `held`, and whether the node's answers may be read now. */
export function candidateSource(list: Read<OperatorsView>, held: { view: OperatorsView; verifiedAtMs: number } | null, nodeReadable: boolean): CandidateSource {
  if (list.status === "ready" && list.value !== null) return { kind: "current" };
  if (nodeReadable && list.status === "loading") return { kind: "loading" };
  const why: NoList = nodeReadable ? "unread" : "unverified";
  return held === null ? { kind: "none", why } : { kind: "held", verifiedAtMs: held.verifiedAtMs, block: held.view.block.number, why };
}

/** Whether a picker offers the address field: off the node's list, and while anything typed stays, so a destination is never swapped under the visitor. */
export function offersTyped(source: CandidateSource, typed: string): boolean {
  return source.kind === "held" || source.kind === "none" || typed.trim() !== "";
}

/**
 * The candidate a picker names: what is typed, lowercased, once it is an address, else the chosen
 * option; null for typed text that is not an address, or with nothing to choose. What is typed holds
 * when the node's list comes back, until the visitor clears it.
 */
export function pickedCandidate(typed: string, value: string | null): string | null {
  const text = typed.trim();
  if (text === "") return value;
  return ADDRESS.test(text) ? text.toLowerCase() : null;
}
