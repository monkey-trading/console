/**
 * The Staking page's daily rotation (monkey-trading/console#280): the rotation set in effect and the
 * next one, today's and tomorrow's turns, and the turn history, from the node's signed
 * `GET /v1/operator` as the log mirrors them (monkey-trading/engine#587). Each member's expected share
 * of turns is its weight over the set's, the odds of the day's draw; a skip or a promotion reassigns a
 * turn already drawn, so it is a record of its own in the history.
 */

import type { OperatorRoute, RotationSetView, TurnReason, TurnRecordView, TurnView } from "../engine/stats-types";
import { shareBps } from "../monkey/figures";
import { formatStamp } from "../time";
import { ADDRESS } from "./candidate-choice";

export interface SetMember {
  address: string;
  adminKey: string;
  /** Its delegated stake when the set was adopted, in MONKEY base units. */
  weight: bigint;
  /** `weight` over the set's total, in basis points: its expected share of turns. */
  turnShareBps: number;
}

export interface RotationSet {
  set: number;
  epoch: number;
  effectiveAtMs: number;
  members: readonly SetMember[];
  totalWeight: bigint;
}

export interface Turn {
  turn: number;
  position: number;
  reason: TurnReason;
  set: number;
  candidate: string;
  adminKey: string;
  appliesAtMs: number;
  /** Whether its member's enclave has started sequencing it. */
  taken: boolean;
}

export interface TurnRecord {
  turn: number;
  position: number;
  reason: TurnReason;
  candidate: string;
  /** The turn's key and when it signs from; `appliesAtMs` is null for an assignment the engine refused. */
  appliesAtMs: number | null;
  /** Why the engine refused the assignment, keeping the key in effect. */
  refused: string | null;
  assignedSeq: number;
  assignedMs: number;
  takenMs: number | null;
}

export interface TurnHistory {
  records: readonly TurnRecord[];
  /** The `before` for the page after these, null when none is held. */
  next: number | null;
  /** Whether the node dropped older records for room, so the end of the history is the end of what it holds. */
  truncated: boolean;
}

/** The node's rotation state as the page uses it. */
export interface RotationView {
  /** The set turns are drawn from now, and the next one to take effect. */
  set: RotationSet | null;
  nextSet: RotationSet | null;
  /** Today's turn and tomorrow's, once drawn and mirrored. */
  turn: Turn | null;
  nextTurn: Turn | null;
  history: TurnHistory;
  /** The vault's signer epoch and the key it names, as the node last read them. */
  signer: { epoch: number; address: string } | null;
}

const REASONS: readonly TurnReason[] = ["draw", "skip", "promotion"];
const WEIGHT = /^\d+$/;

/**
 * A lowercase address.
 * Error cases:
 * - it is not one
 */
function address(text: unknown): string {
  if (typeof text !== "string" || !ADDRESS.test(text)) throw new Error("The node's rotation named an address that is not one.");
  return text.toLowerCase();
}

/**
 * A whole non-negative number the node counts: a seq, a turn, a position or a time.
 * Error cases:
 * - it is not a safe non-negative integer
 */
function count(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`The node's rotation named ${what} that is not a whole number.`);
  return value;
}

/**
 * The reason a turn was assigned, as the node names it.
 * Error cases:
 * - a reason this console does not know
 */
function reason(value: unknown): TurnReason {
  const found = REASONS.find((known) => known === value);
  if (found === undefined) throw new Error("The node's rotation named a reason for a turn that this console does not know.");
  return found;
}

/**
 * A rotation set with each member's share.
 * Error cases:
 * - a member's weight or address, or a number, is malformed, or a member is named twice
 */
export function rotationSet(wire: RotationSetView): RotationSet {
  const weights = wire.members.map((member) => {
    if (typeof member.weight !== "string" || !WEIGHT.test(member.weight)) throw new Error("The node's rotation set named a weight that is not a whole amount.");
    return BigInt(member.weight);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  const members = wire.members.map((member, index): SetMember => {
    const weight = weights[index] ?? 0n;
    return { address: address(member.candidate), adminKey: address(member.admin_key), weight, turnShareBps: shareBps(weight, totalWeight) };
  });
  if (new Set(members.map((member) => member.address)).size !== members.length) throw new Error("The node's rotation set named a member twice.");
  return { set: count(wire.set, "a set number"), epoch: count(wire.epoch, "an epoch"), effectiveAtMs: count(wire.effective_at, "a time"), members, totalWeight };
}

/**
 * A turn assignment.
 * Error cases:
 * - an address, number or reason is malformed
 */
export function turnOf(wire: TurnView): Turn {
  return {
    turn: count(wire.turn, "a turn"), position: count(wire.position, "a position"), reason: reason(wire.reason), set: count(wire.set, "a set number"),
    candidate: address(wire.candidate), adminKey: address(wire.admin_key), appliesAtMs: count(wire.applies_at, "a time"), taken: wire.taken === true,
  };
}

/** One record of the turn history; `null` for the fields a record may lack. */
function recordOf(wire: TurnRecordView): TurnRecord {
  return {
    turn: count(wire.turn, "a turn"), position: count(wire.position, "a position"), reason: reason(wire.reason), candidate: address(wire.candidate),
    appliesAtMs: wire.applies_at === null ? null : count(wire.applies_at, "a time"),
    refused: typeof wire.refused === "string" ? wire.refused : null,
    assignedSeq: count(wire.assigned_seq, "a seq"), assignedMs: count(wire.assigned_ms, "a time"),
    takenMs: wire.taken_ms === null || wire.taken_ms === undefined ? null : count(wire.taken_ms, "a time"),
  };
}

/** The most records one page of the history may hold: the node's page limit. */
export const TURNS_PAGE_LIMIT = 100;

/**
 * The turn history page `wire` names.
 * Error cases:
 * - the page holds more records than the node's limit, or a record is malformed
 */
export function turnHistory(wire: { records: TurnRecordView[]; next: number | null; truncated: boolean } | undefined): TurnHistory {
  if (wire === undefined) return { records: [], next: null, truncated: false };
  if (wire.records.length > TURNS_PAGE_LIMIT) throw new Error("The node's turn history page is longer than its limit.");
  return { records: wire.records.map(recordOf), next: wire.next === null ? null : count(wire.next, "a seq"), truncated: wire.truncated === true };
}

/**
 * The page's view of `route`'s rotation: everything absent from a node that predates the daily turns
 * is null or empty.
 * Error cases:
 * - an address, amount, number or reason in it is malformed
 */
export function rotationView(route: OperatorRoute): RotationView {
  return {
    set: route.rotation_set === undefined || route.rotation_set === null ? null : rotationSet(route.rotation_set),
    nextSet: route.next_rotation_set === undefined || route.next_rotation_set === null ? null : rotationSet(route.next_rotation_set),
    turn: route.turn === undefined || route.turn === null ? null : turnOf(route.turn),
    nextTurn: route.next_turn === undefined || route.next_turn === null ? null : turnOf(route.next_turn),
    history: turnHistory(route.turns),
    signer: route.signer === undefined ? null : { epoch: count(route.signer.epoch, "an epoch"), address: address(route.signer.address) },
  };
}

/** A skip or a promotion: a turn reassigned from the member the draw named, or one the engine refused. */
export function isReassignment(record: TurnRecord): boolean {
  return record.reason !== "draw" || record.refused !== null;
}

/** What a turn's reason says in words. */
export const REASON_WORDS: Record<TurnReason, string> = {
  draw: "Draw: the day's draw named this member",
  skip: "Skip: the member before it did not take the turn in time",
  promotion: "Promotion: the liveness rule moved the turn from a failed member",
};
/** The reason's one word, for a table's cell. */
export const REASON_CELL: Record<TurnReason, string> = { draw: "Draw", skip: "Skip", promotion: "Promotion" };

/** The first words of a record's outcome: refused, taken, or assigned and waiting for its member. */
export function recordState(record: TurnRecord): "refused" | "taken" | "assigned" {
  return record.refused !== null ? "refused" : record.takenMs !== null ? "taken" : "assigned";
}

/**
 * A turn in a line for the operators card: its member (named by `name`), what put it there when it
 * is not the draw, and when its key signs from.
 */
export function turnLine(turn: Turn | null, name: (address: string) => string, none: string): string {
  if (turn === null) return none;
  const why = turn.reason === "draw" ? "" : turn.reason === "skip" ? ", after a skip" : ", after a promotion";
  const from = `from ${formatStamp(turn.appliesAtMs)} UTC`;
  return `${name(turn.candidate)}${why}, ${from}${turn.taken ? "" : ", not started yet"}`;
}
