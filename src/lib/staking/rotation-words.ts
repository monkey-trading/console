/** What the Rotation tab says of a set and of each turn record (monkey-trading/console#280), apart from the components so the words are tested. */

import { formatDuration } from "../monkey/figures";
import { formatStamp, formatStampWithYear } from "../time";
import type { RotationSet, TurnRecord } from "./rotation";

/** A set's line: its number and registry epoch, and when it took effect or takes effect, with the wait when that is ahead. */
export function setLine(set: RotationSet, nowMs: number): string {
  const ahead = nowMs > 0 && set.effectiveAtMs > nowMs;
  const when = ahead ? `takes effect at ${formatStamp(set.effectiveAtMs)} UTC, in ${formatDuration(set.effectiveAtMs - nowMs)}` : `in effect since ${formatStamp(set.effectiveAtMs)} UTC`;
  const members = set.members.length === 1 ? "1 member" : `${set.members.length} members`;
  return `Set ${set.set}, adopted at registry epoch ${set.epoch}, ${members}; ${when}.`;
}

/** When a record's key signs from: a dash for an assignment the engine refused. */
export function recordFrom(record: TurnRecord): string {
  return record.appliesAtMs === null ? "—" : formatStampWithYear(record.appliesAtMs);
}

/** How a record stands: refused with the engine's reason, taken since a time, or assigned and waiting for its member's enclave. */
export function recordOutcome(record: TurnRecord): string {
  if (record.refused !== null) return `Refused: ${record.refused}. The key in effect stayed.`;
  if (record.takenMs !== null) return `Taken at ${formatStampWithYear(record.takenMs)} UTC`;
  return "Assigned; its member has not started it";
}

/** The longest turn line a row is likely to show, laid out unseen so the line landing moves nothing below it. */
export const TURN_RESERVE = "alpha.operators.example (0x627261…0000), after a promotion, from 28 Oct 22:30:00 UTC, not started yet";
