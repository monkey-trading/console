/** What the Rotation tab says of the operator groups and of each turn record (monkey-trading/console#280), apart from the components so the words are tested. */

import { spokenLongCountdown } from "../monkey/countdown";
import { formatStamp, formatStampWithYear } from "../time";
import { turnStartMs, type RotationSet, type TurnRecord } from "./rotation";

/** How many operators a group has, as a sentence says it. */
function operators(set: RotationSet): string {
  return set.members.length === 1 ? "one operator" : `${set.members.length} operators`;
}

/** A time ahead with the wait until it, or the time alone once it has come or with no clock read yet. */
function at(ms: number, nowMs: number): string {
  return nowMs > 0 && ms > nowMs ? `${formatStamp(ms)} UTC, in ${spokenLongCountdown(ms, nowMs)}` : `${formatStamp(ms)} UTC`;
}

/** The current group's line: how many operators it has and since when they have run the trading server. */
export function currentGroupLine(set: RotationSet, nowMs: number): string {
  if (nowMs > 0 && set.effectiveAtMs > nowMs) return `The current group has ${operators(set)}, listed below, and begins running the trading server in turns at ${at(set.effectiveAtMs, nowMs)}.`;
  return `The current group has ${operators(set)}, listed below, and has run the trading server in turns since ${formatStamp(set.effectiveAtMs)} UTC.`;
}

/**
 * The next group's line: its operators and when it takes over, or, before an election has chosen it, when the next election is due
 * to close (`electionAtMs`, null when unknown) and that the current group continues until a new group takes over. A rotation set takes
 * effect seven days and the registry's finality margin after the close that adopted it (`OperatorRegistry.closeEpoch`), so "about".
 */
export function nextGroupLine(next: RotationSet | null, context: { current: boolean; rotationOn: boolean | null; electionAtMs: number | null }, nowMs: number): string {
  if (next !== null) {
    const ahead = nowMs > 0 && next.effectiveAtMs > nowMs;
    const starts = context.current ? "takes over from the current group" : "begins running the trading server in turns";
    return `The next group has ${operators(next)}, listed below, and ${starts} at ${at(next.effectiveAtMs, nowMs)}.${ahead && context.current ? " Until then, the current group continues to run the trading server." : ""}`;
  }
  if (context.rotationOn === false) return "No next group of operators has been chosen, and none is chosen while operator rotation is off.";
  const { electionAtMs } = context;
  const election = electionAtMs === null ? "It will be chosen at the next election."
    : nowMs > 0 && electionAtMs <= nowMs ? `It will be chosen when the current election is closed, which has been due since ${formatStamp(electionAtMs)} UTC.`
      : `It will be chosen at the next election, which is due to close at ${at(electionAtMs, nowMs)}.`;
  const until = context.current ? ", and the current group continues to run the trading server until then" : "";
  return `The next group of operators has not yet been chosen. ${election} A group takes over about seven days after the election that chooses it${until}.`;
}

/** When a record's operator starts, or for a refused assignment when its turn was due to begin. */
export function recordFrom(record: TurnRecord): string {
  return formatStampWithYear(turnStartMs(record));
}

/** What the operator already running the trading server does when a turn is refused. */
const KEPT = "The operator already running the trading server stays in place.";

/** Why the engine refused a turn, in words, by the reason it logs (`DailyTurns::set_refusal` and `turn_refusal`); a notice of a day's turns is seven days, and of a development build's short turns one turn. */
const REFUSALS: readonly [RegExp, string][] = [
  [/^turn \d+ ended before its assignment was mirrored$/, "The turn had already ended when the trading server recorded the operator assigned to it."],
  [/^set \d+ is not among the sets mirrored$/, "The trading server has no record of the operator group the turn was drawn from."],
  [/^set \d+ does not name candidate /, "The operator group the turn was drawn from does not include this operator with its current operator key."],
  [/, less than seven days before the turn applies at \d+$/, "An operator must be announced at least seven days before its turn begins, and the operator assigned this turn was announced later than that."],
  [/, less than one turn before the turn applies at \d+$/, "An operator must be announced at least one turn before its turn begins, and the operator assigned this turn was announced later than that."],
];

/** How a record stands: refused, with the engine's reason in words, taken since a time, or assigned and waiting for its member's enclave. */
export function recordOutcome(record: TurnRecord): string {
  if (record.refused !== null) {
    const known = REFUSALS.find(([pattern]) => pattern.test(record.refused ?? ""));
    return `Refused. ${known === undefined ? "The operator assigned this turn could not take over." : known[1]} ${KEPT}`;
  }
  if (record.takenMs !== null) return `Started at ${formatStampWithYear(record.takenMs)} UTC`;
  return "Assigned but not yet started";
}

/** The longest turn line a row is likely to show, laid out unseen so the line landing moves nothing below it. */
export const TURN_RESERVE = "alpha.operators.example (0x627261…0000), after a promotion, from 28 Oct 22:30:00 UTC, not yet started";

/** The longest lines each group card is likely to show, laid out unseen in the same way. */
const SAMPLE_MS = Date.UTC(2026, 9, 28, 22, 30);
const SAMPLE_WAIT_MS = SAMPLE_MS - (6 * 24 + 23) * 3_600_000 - 1;
const longest = (lines: string[]) => lines.reduce((best, line) => (line.length > best.length ? line : best));
const sampleSet: RotationSet = { set: 0, epoch: 0, effectiveAtMs: SAMPLE_MS, members: Array.from({ length: 10 }, () => ({ address: "", adminKey: "", weight: 0n, turnShareBps: 0 })), totalWeight: 0n };
export const CURRENT_GROUP_RESERVE = currentGroupLine(sampleSet, SAMPLE_WAIT_MS);
export const NEXT_GROUP_RESERVE = longest([
  nextGroupLine(sampleSet, { current: true, rotationOn: true, electionAtMs: null }, SAMPLE_WAIT_MS),
  nextGroupLine(null, { current: true, rotationOn: true, electionAtMs: SAMPLE_MS }, SAMPLE_WAIT_MS),
  nextGroupLine(null, { current: true, rotationOn: true, electionAtMs: SAMPLE_MS }, SAMPLE_MS + 1),
]);
