/** What the Rotation tab says of a set and of each turn record (monkey-trading/console#280), apart from the components so the words are tested. */

import { spokenLongCountdown } from "../monkey/countdown";
import { formatStamp, formatStampWithYear } from "../time";
import type { RotationSet, TurnRecord } from "./rotation";

/** A set's line: its number and registry epoch, and when it took effect or takes effect, with the wait when that is ahead. */
export function setLine(set: RotationSet, nowMs: number): string {
  const ahead = nowMs > 0 && set.effectiveAtMs > nowMs;
  const when = ahead ? `It starts at ${formatStamp(set.effectiveAtMs)} UTC, in ${spokenLongCountdown(set.effectiveAtMs, nowMs)}` : `It has been running since ${formatStamp(set.effectiveAtMs)} UTC`;
  const members = set.members.length === 1 ? "1 operator" : `${set.members.length} operators`;
  return `Rotation ${set.set} was chosen at election ${set.epoch} and has ${members}. ${when}.`;
}

/** When a record's key signs from: a dash for an assignment the engine refused. */
export function recordFrom(record: TurnRecord): string {
  return record.appliesAtMs === null ? "—" : formatStampWithYear(record.appliesAtMs);
}

/** Why the engine refused a turn, in words, by the reason it logs; a reason not known here reads as the generic line. */
const REFUSALS: readonly [RegExp, string][] = [
  [/^turn \d+ ended before its assignment was mirrored$/, "Refused, because the turn had already ended when it was recorded."],
  [/^set \d+ is not among the sets mirrored$/, "Refused, because the rotation it was drawn from had not been recorded."],
  [/^set \d+ does not name candidate /, "Refused, because the rotation it was drawn from does not name this operator with this key."],
  [/less than seven days before the turn applies|seven days earlier names its key$/, "Refused, because its operator was not named in a rotation announced at least seven days earlier."],
];

/** How a record stands: refused, with the engine's reason in words, taken since a time, or assigned and waiting for its member's enclave. */
export function recordOutcome(record: TurnRecord): string {
  if (record.refused !== null) {
    const known = REFUSALS.find(([pattern]) => pattern.test(record.refused ?? ""));
    return known === undefined ? "Refused. The turn could not take effect, so the current operator continued." : `${known[1]} The current operator continued.`;
  }
  if (record.takenMs !== null) return `Started at ${formatStampWithYear(record.takenMs)} UTC`;
  return "Assigned but not yet started";
}

/** The longest turn line a row is likely to show, laid out unseen so the line landing moves nothing below it. */
export const TURN_RESERVE = "alpha.operators.example (0x627261…0000), after a promotion, from 28 Oct 22:30:00 UTC, not yet started";
