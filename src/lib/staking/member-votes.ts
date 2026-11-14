/**
 * How the members an account delegates to, and the account itself, stand on each proposal the
 * Governance tab shows (monkey-trading/console#281), from the vote contract through the wallet: each
 * proposal's set (`OperatorSchedule.setOf`, fixed once adopted), the set a passed proposal opened under
 * with its final tally (`ParameterVote.proposalOf`, which the node does not serve), and whether each
 * member voted (`ParameterVote.voted`). An answer read once the proposal no longer takes votes is
 * final; one read while it does, a yes included, is read again, since the latest block it was read at
 * could still be reorganised away.
 */

import type { ChainProposal } from "../engine/governance-wallet";

/** A proposal the tab shows: its id, the set it opened under where the node names it, and whether it still takes votes. */
export interface VoteTarget {
  id: number;
  setId: number | null;
  open: boolean;
}

/** What the wallet has read for one vote contract. */
export interface MemberVoteFacts {
  /** Each set's members with their weights, by set id. */
  sets: ReadonlyMap<number, ReadonlyMap<string, bigint>>;
  /** Proposals the node names no set for, as the chain holds them, by id; null for one the chain does not hold. */
  proposals: ReadonlyMap<number, ChainProposal | null>;
  /** Whether each member voted, by `voteKey`; `final` once it cannot change, and `at` the count of vote reads when it was read. */
  voted: ReadonlyMap<string, { voted: boolean; final: boolean; at: number }>;
  /** How many votes have been read, which orders the ones read again oldest first. */
  reads: number;
}

export const NO_FACTS: MemberVoteFacts = { sets: new Map(), proposals: new Map(), voted: new Map(), reads: 0 };

/** One wallet read the facts lack. */
export type VoteCall =
  | { kind: "proposal"; id: number }
  | { kind: "set"; setId: number }
  | { kind: "voted"; id: number; member: string; open: boolean };

/** What one call answered. */
export type VoteAnswer =
  | { kind: "proposal"; id: number; proposal: ChainProposal | null }
  | { kind: "set"; setId: number; members: ReadonlyMap<string, bigint> }
  | { kind: "voted"; id: number; member: string; open: boolean; voted: boolean };

/** How a member stands on a proposal: voted yes; in its set without a yes; outside its set; or not read yet. */
export type Standing = "yes" | "no" | "outside" | "unknown";

/** The most calls one read makes, so a long list never holds the wallet for long; the rest follow at the next. */
export const MAX_CALLS = 40;

export const voteKey = (id: number, member: string): string => `${id}:${member}`;

/** The set proposal `target` opened under: the node's, or the chain's for a passed one; null until read. */
export function setOf(facts: MemberVoteFacts, target: Pick<VoteTarget, "id" | "setId">): number | null {
  return target.setId ?? facts.proposals.get(target.id)?.setId ?? null;
}

/**
 * The reads `facts` lacks for `targets` and `members` (lowercase, the account and the candidates it
 * delegates to), in the order the page needs them: the passed proposals' sets from the chain, then the
 * sets, then each member's vote not read yet, open proposals first, then the votes read again, the
 * longest ago first, so a list past `MAX_CALLS` is read through in turn. Each set is read once.
 */
export function plan(facts: MemberVoteFacts, targets: readonly VoteTarget[], members: readonly string[]): VoteCall[] {
  if (members.length === 0) return [];
  const calls: VoteCall[] = [];
  const sets = new Set<number>();
  const ordered = [...targets].sort((a, b) => Number(b.open) - Number(a.open));
  for (const target of ordered) {
    if (target.setId === null && !facts.proposals.has(target.id)) calls.push({ kind: "proposal", id: target.id });
  }
  for (const target of ordered) {
    const setId = setOf(facts, target);
    if (setId !== null && !facts.sets.has(setId) && !sets.has(setId)) {
      sets.add(setId);
      calls.push({ kind: "set", setId });
    }
  }
  const again: { call: VoteCall; at: number }[] = [];
  for (const target of ordered) {
    const setId = setOf(facts, target);
    const set = setId === null ? undefined : facts.sets.get(setId);
    if (set === undefined) continue;
    for (const member of members) {
      const read = facts.voted.get(voteKey(target.id, member));
      if (!set.has(member) || read?.final === true) continue;
      const call: VoteCall = { kind: "voted", id: target.id, member, open: target.open };
      if (read === undefined) calls.push(call);
      else again.push({ call, at: read.at });
    }
  }
  again.sort((a, b) => a.at - b.at);
  return [...calls, ...again.map(({ call }) => call)].slice(0, MAX_CALLS);
}

/** `facts` with one call's answer folded in; a set fixes once read, and a vote once read while the proposal took none. */
export function fold(facts: MemberVoteFacts, answer: VoteAnswer): MemberVoteFacts {
  switch (answer.kind) {
    case "proposal": return { ...facts, proposals: new Map(facts.proposals).set(answer.id, answer.proposal) };
    case "set": return { ...facts, sets: new Map(facts.sets).set(answer.setId, answer.members) };
    case "voted": {
      const reads = facts.reads + 1;
      return { ...facts, reads, voted: new Map(facts.voted).set(voteKey(answer.id, answer.member), { voted: answer.voted, final: !answer.open, at: reads }) };
    }
    default: {
      const never: never = answer;
      throw new Error(`Unknown vote read ${String(never)}.`);
    }
  }
}

/** How `member` stands on proposal `target`. */
export function standing(facts: MemberVoteFacts, target: Pick<VoteTarget, "id" | "setId">, member: string): Standing {
  const setId = setOf(facts, target);
  const set = setId === null ? undefined : facts.sets.get(setId);
  if (set === undefined) return "unknown";
  if (!set.has(member)) return "outside";
  const vote = facts.voted.get(voteKey(target.id, member));
  if (vote === undefined) return "unknown";
  return vote.voted ? "yes" : "no";
}

/** `member`'s weight in the set proposal `target` opened under; null until that set is read. */
export function weightIn(facts: MemberVoteFacts, target: Pick<VoteTarget, "id" | "setId">, member: string): bigint | null {
  const setId = setOf(facts, target);
  const set = setId === null ? undefined : facts.sets.get(setId);
  return set === undefined ? null : (set.get(member) ?? 0n);
}
