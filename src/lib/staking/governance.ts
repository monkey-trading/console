/**
 * The Staking section's Governance tab (monkey-trading/console#281) as the page uses it: the open
 * proposals the node's operator list carries and the passed changes waiting and restrictions in force
 * its house state carries (monkey-trading/engine#548, from V56), each checked as it is read, and the
 * vote contract's tally rule (`ParameterVote.passes`): a proposal passes once its yes weight is more
 * than two thirds of its set's total, `yes * 3 > total * 2`.
 */

import type { AdminCommandWire, GovernanceWire, LimitWire, OpenProposalsWire } from "../engine/governance-types";
import type { Tier } from "../engine/types";
import type { Read } from "../monkey/figures";
import { ADDRESS } from "./candidate-choice";

/** A proposal's yes weight and its set's total weight, in MONKEY base units. */
export interface Tally {
  yes: bigint;
  total: bigint;
}

export interface OpenProposal {
  id: number;
  proposer: string;
  setId: number;
  /** The fast path: a restriction in force at once if it passes. */
  fast: boolean;
  opensAtMs: number;
  closesAtMs: number;
  tally: Tally;
  commandHash: string;
  /** Null for bytes that decode to no admin command, which the engine refuses if the proposal passes. */
  command: AdminCommandWire | null;
}

/** The vote contract's open proposals at the operator list's block. */
export interface ProposalsView {
  /** The vote contract, lowercase. */
  vote: string;
  /** Newest first. */
  open: readonly OpenProposal[];
  /** Whether the node's read stopped before every proposal that could still be open. */
  truncated: boolean;
  /** Whether the node could not read them, so none are listed though some may be open. */
  unavailable: boolean;
}

export interface WaitingChange {
  id: number;
  command: AdminCommandWire;
  appliesAtMs: number;
}

/** A restriction's limit as the page shows it: one of the engine's kinds, or one a later engine added, named by its kind. */
export type ShownLimit = LimitWire | { kind: "unknown"; name: string };

export interface RestrictionInForce {
  id: number;
  limit: ShownLimit;
  expiresAtMs: number;
}

/** What the log holds of the votes: the contract it follows, the changes waiting in the order they apply, and the restrictions in force soonest lapsing first. */
export interface GovernanceView {
  /** The vote contract the log records, lowercase; null before one is recorded. */
  vote: string | null;
  restrictionTtlMs: number | null;
  waiting: readonly WaitingChange[];
  inForce: readonly RestrictionInForce[];
  /** The restricted fields as the baseline sets them, while a restriction holds one. */
  paramsBaseline: GovernanceWire["params_baseline"] | null;
  marketBaselines: Readonly<Record<string, { margin_tiers: Tier[]; house_cap_bps: number; house_cap_floor: string }>>;
}

export const NO_GOVERNANCE: GovernanceView = { vote: null, restrictionTtlMs: null, waiting: [], inForce: [], paramsBaseline: null, marketBaselines: {} };

const UNITS = /^\d+$/;
const LIMIT_KINDS: ReadonlySet<string> = new Set(["params", "market", "stress_floor", "reduce_only"]);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const whole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const isCommand = (command: unknown): command is AdminCommandWire =>
  typeof command === "object" && command !== null && typeof (command as { action?: unknown }).action === "string";

/**
 * The open proposals of `wire`, checked: each weight whole base units with the yes within the total,
 * each id, set and time a whole number, closing after it opened, each address and hash well formed.
 * Error cases:
 * - any of those is malformed
 */
export function proposalsView(wire: OpenProposalsWire): ProposalsView {
  if (!ADDRESS.test(wire.vote)) throw new Error("The operator list named a vote contract that is not an address.");
  const open = wire.open.map((proposal): OpenProposal => {
    const ok = [proposal.id, proposal.set_id, proposal.opens_at_ms, proposal.closes_at_ms].every(whole) && proposal.closes_at_ms > proposal.opens_at_ms
      && UNITS.test(proposal.yes_weight) && UNITS.test(proposal.total_weight) && ADDRESS.test(proposal.proposer) && HASH.test(proposal.command_hash)
      && typeof proposal.fast === "boolean" && (proposal.command === null || isCommand(proposal.command));
    if (!ok) throw new Error(`The operator list named a malformed open proposal ${String(proposal.id)}.`);
    const tally = { yes: BigInt(proposal.yes_weight), total: BigInt(proposal.total_weight) };
    if (tally.yes > tally.total) throw new Error(`The operator list named proposal ${proposal.id} with more yes weight than its set holds.`);
    return {
      id: proposal.id, proposer: proposal.proposer.toLowerCase(), setId: proposal.set_id, fast: proposal.fast, opensAtMs: proposal.opens_at_ms,
      closesAtMs: proposal.closes_at_ms, tally, commandHash: proposal.command_hash.toLowerCase(), command: proposal.command,
    };
  });
  return { vote: wire.vote.toLowerCase(), open, truncated: wire.truncated, unavailable: wire.unavailable === true };
}

/**
 * The votes the log holds, from `wire` (null before any is recorded), checked: each proposal and time
 * a whole number, each command tagged, each restriction keyed by its proposal.
 * Error cases:
 * - any of those is malformed
 */
export function governanceView(wire: GovernanceWire | null): GovernanceView {
  if (wire === null) return NO_GOVERNANCE;
  const config = wire.config;
  if (config !== undefined && (!ADDRESS.test(config.vote) || !whole(config.restriction_ttl_ms))) throw new Error("The house state named a malformed vote contract.");
  const waiting = (wire.pending ?? []).map((change): WaitingChange => {
    if (!whole(change.proposal) || !whole(change.applies_at) || !isCommand(change.command)) throw new Error("The house state named a malformed waiting change.");
    return { id: change.proposal, command: change.command, appliesAtMs: change.applies_at };
  });
  const inForce = Object.entries(wire.restrictions ?? {}).map(([key, restriction]): RestrictionInForce => {
    const id = Number(key);
    if (!/^\d+$/.test(key) || !whole(id) || !whole(restriction.expires_at) || typeof restriction.limit?.kind !== "string") throw new Error("The house state named a malformed restriction.");
    // A kind a later engine added is listed by its name, so the rest still show.
    const limit: ShownLimit = LIMIT_KINDS.has(restriction.limit.kind) ? restriction.limit : { kind: "unknown", name: restriction.limit.kind };
    return { id, limit, expiresAtMs: restriction.expires_at };
  });
  inForce.sort((a, b) => a.expiresAtMs - b.expiresAtMs || a.id - b.id);
  return {
    vote: config === undefined ? null : config.vote.toLowerCase(), restrictionTtlMs: config?.restriction_ttl_ms ?? null, waiting, inForce,
    paramsBaseline: wire.params_baseline ?? null, marketBaselines: wire.market_baselines ?? {},
  };
}

/** Whether `tally` passes: yes weight strictly more than two thirds of the total, as `ParameterVote.passes` compares it. */
export function passes(tally: Tally): boolean {
  return tally.yes * 3n > tally.total * 2n;
}

/** The least more yes weight that passes `tally`: zero once it passes. */
export function weightToPass(tally: Tally): bigint {
  // `ParameterVote.passes` holds exactly when yes exceeds floor(2 * total / 3).
  const needed = (tally.total * 2n) / 3n + 1n - tally.yes;
  return needed > 0n ? needed : 0n;
}

/** The yes weight as a share of the total, in basis points, truncated; zero for an empty set. */
export function yesShareBps(tally: Tally): number {
  return tally.total === 0n ? 0 : Number((tally.yes * 10_000n) / tally.total);
}

/** The open proposals the votes the log holds have not overtaken: one the node's next list will drop, once it passed, is shown with the passed ones only. */
export function stillOpen(proposals: ProposalsView, view: GovernanceView): readonly OpenProposal[] {
  const passed = new Set([...view.waiting.map((change) => change.id), ...view.inForce.map((restriction) => restriction.id)]);
  return proposals.open.filter((proposal) => !passed.has(proposal.id));
}

/**
 * Where focus goes when open proposals leave the list: when it was in proposal `focused` and that one
 * left, to the same proposal's heading in the passed lists if it moved there, else to the open
 * list's heading; null when focus was not in a proposal that left.
 */
export function focusAfterLeaving(left: readonly number[], focused: number | null, view: GovernanceView): string | null {
  if (focused === null || !left.includes(focused)) return null;
  if (view.waiting.some((change) => change.id === focused)) return `proposal-waiting-${focused}`;
  if (view.inForce.some((restriction) => restriction.id === focused)) return `proposal-restriction-${focused}`;
  return "open-proposals-title";
}

/**
 * Whether a `focusout` from the cards ends the proposal the tab remembers focus in: focus moved to a
 * node outside them, or to none while the element stays in the page. An element's removal fires a
 * `focusout` with no node to move to, and the removal is what `focusAfterLeaving` follows.
 */
export function focusLeftCards(movedTo: "cards" | "outside" | "nowhere", removed: boolean): boolean {
  return movedTo === "outside" || (movedTo === "nowhere" && !removed);
}

/**
 * Whether the open card names the proposal the `governance` notice speaks for: the vote was pressed
 * on one that has left the list, and the surface still has a notice or the wallet's prompt to show
 * under the name. A vote that landed leaves neither, and a name with nothing under it says nothing.
 */
export function awayLabelShown(votingOn: number | null, openIds: readonly number[], speaks: boolean): boolean {
  return votingOn !== null && speaks && !openIds.includes(votingOn);
}

/** What the tab shows before its cards: the node's reads, the wallet's, or the cards. */
export type GovernanceGate = "node" | "wallet" | "shown";

/**
 * The cards show once the node's two reads have landed and the wallet's answers (the account's
 * delegations and votes) have, or have been waited for (`waited`); the wallet's reads never hold
 * the node's up, since a request waiting elsewhere in the wallet can hold them for good. Once
 * `shown`, they stay.
 */
export function governanceGate({ list, held, wallet, waited, shown }: { list: Read<unknown>["status"]; held: Read<unknown>["status"]; wallet: boolean; waited: boolean; shown: boolean }): GovernanceGate {
  if (shown) return "shown";
  if (list === "loading" || held === "loading") return "node";
  return wallet || waited ? "shown" : "wallet";
}
