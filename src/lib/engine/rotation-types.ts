/** The daily rotation as `GET /v1/operator` answers it (monkey-trading/console#280). */

import type { Address } from "./types";

/** One member of a rotation set: its delegated stake when the set was adopted is the weight it is drawn by (a decimal string of MONKEY base units). */
export interface SetMemberView {
  candidate: Address;
  admin_key: Address;
  weight: string;
}

/** A rotation set the operator schedule adopted, as the node mirrors it. */
export interface RotationSetView {
  set: number;
  epoch: number;
  /** When the set takes effect on chain, in milliseconds. */
  effective_at: number;
  logged_at: number;
  members: SetMemberView[];
}

/** Why the schedule named a turn's member: the day's draw, the next position after one that did not take its turn in time, or the liveness rule's move from a failed member. */
export type TurnReason = "draw" | "skip" | "promotion";

/** A turn assignment the engine accepted; `taken` once its member's enclave logged `TurnTaken`. */
export interface TurnView {
  turn: number;
  position: number;
  reason: TurnReason;
  set: number;
  candidate: Address;
  admin_key: Address;
  /** When its key signs from, in milliseconds: its boundary, or its mirror when that is later. */
  applies_at: number;
  taken: boolean;
}

/** One assignment of a turn in the history, with the `TurnTaken` that completed it; a refused one carries the engine's reason and no `applies_at`. */
export interface TurnRecordView {
  turn: number;
  position: number;
  reason: TurnReason;
  candidate: Address;
  admin_key: Address;
  assigned_seq: number;
  assigned_ms: number;
  applies_at: number | null;
  refused: string | null;
  taken_seq: number | null;
  taken_ms: number | null;
  release: string | null;
}

/** A page of the turn history, newest first; `next` is the `before` for the page after it. */
export interface TurnsPageView {
  records: TurnRecordView[];
  next: number | null;
  /** Whether the node dropped older records for room: a page ending with `next` null is then the end of what is held. */
  truncated: boolean;
  retained_from_seq: number | null;
}
