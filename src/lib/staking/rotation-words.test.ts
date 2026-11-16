/** Tests for what the Rotation tab says of the operator groups and of each turn record (monkey-trading/console#280). */

import { describe, expect, it } from "vitest";

import type { RotationSet, TurnRecord } from "./rotation";
import { currentGroupLine, CURRENT_GROUP_RESERVE, nextGroupLine, NEXT_GROUP_RESERVE, recordFrom, recordOutcome } from "./rotation-words";

const DAY = 86_400_000;
const EFFECTIVE = Date.UTC(2026, 10, 18, 22, 30);
const member = (address: string) => ({ address, adminKey: address, weight: 1n, turnShareBps: 5_000 });
const SET: RotationSet = { set: 4, epoch: 42, effectiveAtMs: EFFECTIVE, members: [member("0xa"), member("0xb")], totalWeight: 2n };
const RECORD: TurnRecord = { turn: 9, position: 0, reason: "draw", candidate: "0xa", adminKey: "0xa", appliesAtMs: EFFECTIVE, refused: null, assignedSeq: 10, assignedMs: EFFECTIVE - 3_600_000, takenMs: null };
const ON = { current: true, rotationOn: true, electionAtMs: null };
const KEPT = "The operator already running the trading server stays in place.";

describe("currentGroupLine", () => {
  it("says how many operators the current group has and since when it has run the trading server, counting one as one", () => {
    expect(currentGroupLine(SET, EFFECTIVE)).toBe("The current group has 2 operators, listed below, and has run the trading server in turns since 18 Nov 22:30:00 UTC.");
    expect(currentGroupLine({ ...SET, members: [member("0xa")] }, 0)).toBe("The current group has one operator, listed below, and has run the trading server in turns since 18 Nov 22:30:00 UTC.");
  });

  it("says when a group not yet running begins, with the wait", () => {
    expect(currentGroupLine(SET, EFFECTIVE - 3 * DAY)).toBe("The current group has 2 operators, listed below, and begins running the trading server in turns at 18 Nov 22:30:00 UTC, in 3 days.");
  });
});

describe("nextGroupLine", () => {
  it("says when a chosen next group takes over, and that the current group runs the trading server until then", () => {
    expect(nextGroupLine(SET, ON, EFFECTIVE - 3 * DAY)).toBe("The next group has 2 operators, listed below, and takes over from the current group at 18 Nov 22:30:00 UTC, in 3 days. Until then, the current group continues to run the trading server.");
    expect(nextGroupLine(SET, ON, EFFECTIVE)).toBe("The next group has 2 operators, listed below, and takes over from the current group at 18 Nov 22:30:00 UTC.");
    expect(nextGroupLine(SET, { ...ON, current: false }, EFFECTIVE - 3 * DAY)).toBe("The next group has 2 operators, listed below, and begins running the trading server in turns at 18 Nov 22:30:00 UTC, in 3 days.");
  });

  it("before one is chosen, says when the next election is due to close, that a group takes over about seven days later, and that the current group continues until then", () => {
    const tail = "A group takes over about seven days after the election that chooses it, and the current group continues to run the trading server until then.";
    expect(nextGroupLine(null, { ...ON, electionAtMs: EFFECTIVE }, EFFECTIVE - 5 * 3_600_000)).toBe(`The next group of operators has not yet been chosen. It will be chosen at the next election, which is due to close at 18 Nov 22:30:00 UTC, in 5 hours. ${tail}`);
    expect(nextGroupLine(null, { ...ON, electionAtMs: EFFECTIVE }, EFFECTIVE + 60_000)).toBe(`The next group of operators has not yet been chosen. It will be chosen when the current election is closed, which has been due since 18 Nov 22:30:00 UTC. ${tail}`);
    expect(nextGroupLine(null, ON, EFFECTIVE)).toBe(`The next group of operators has not yet been chosen. It will be chosen at the next election. ${tail}`);
    expect(nextGroupLine(null, { ...ON, current: false }, EFFECTIVE)).toBe("The next group of operators has not yet been chosen. It will be chosen at the next election. A group takes over about seven days after the election that chooses it.");
  });

  it("says no next group is chosen while operator rotation is off", () => {
    expect(nextGroupLine(null, { ...ON, rotationOn: false, electionAtMs: EFFECTIVE }, EFFECTIVE - DAY)).toBe("No next group of operators has been chosen, and none will be chosen while operator rotation is off.");
  });

  it("reserves room for the longest line of each card", () => {
    expect(CURRENT_GROUP_RESERVE.length).toBeGreaterThanOrEqual(currentGroupLine({ ...SET, members: Array.from({ length: 10 }, (_, i) => member(String(i))) }, EFFECTIVE - 6 * DAY).length);
    expect(NEXT_GROUP_RESERVE.length).toBeGreaterThanOrEqual(nextGroupLine(null, { ...ON, electionAtMs: EFFECTIVE }, EFFECTIVE - 6 * DAY).length);
  });
});

describe("a record's words", () => {
  it("starts a record when its key signs from, and a refused one when its turn was due to begin", () => {
    expect(recordFrom(RECORD)).toBe("2026-11-18 22:30");
    // Turn 5982886 of a development build's five-minute turns began at 21:50 UTC on 16 November.
    expect(recordFrom({ ...RECORD, turn: 5_982_886, appliesAtMs: null, refused: "late", assignedMs: Date.UTC(2026, 10, 16, 21, 46) })).toBe("2026-11-16 21:50");
  });

  it("explains each refusal the engine logs, in its daily and short-turn forms, and any other plainly", () => {
    const refused = (reason: string) => recordOutcome({ ...RECORD, appliesAtMs: null, refused: reason });
    const daily = `Refused. An operator must be announced at least seven days before its turn begins, and the operator assigned the turn was announced later than that. ${KEPT}`;
    const short = `Refused. An operator must be announced at least one turn before its turn begins, and the operator assigned the turn was announced later than that. ${KEPT}`;
    expect(refused("set 1 was logged at 1794865500000, less than seven days before the turn applies at 1794865800000")).toBe(daily);
    expect(refused("set 2 names the key the log has named since 1794865500000, less than seven days before the turn applies at 1794865800000")).toBe(daily);
    expect(refused("set 1 was logged at 1794865500000, less than one turn before the turn applies at 1794865800000")).toBe(short);
    expect(refused("set 2 names the key the log has named since 1794865500000, less than one turn before the turn applies at 1794865800000")).toBe(short);
    expect(refused("turn 812 ended before its assignment was mirrored")).toBe(`Refused. The turn had already ended when the trading server recorded the operator assigned to it. ${KEPT}`);
    expect(refused("set 3 is not among the sets mirrored")).toBe(`Refused. The trading server has no record of the operator group the turn was drawn from. ${KEPT}`);
    expect(refused("set 3 does not name candidate 0xab with key 0xcd")).toBe(`Refused. The operator group the turn was drawn from does not include the assigned operator with its current operator key. ${KEPT}`);
    expect(refused("no set names its key")).toBe(`Refused. The operator assigned the turn could not take over. ${KEPT}`);
  });

  it("says when a taken turn started, and that one not taken yet has not started", () => {
    expect(recordOutcome({ ...RECORD, takenMs: EFFECTIVE + 4_000 })).toBe("Started at 2026-11-18 22:30 UTC");
    expect(recordOutcome(RECORD)).toBe("Assigned but not yet started");
  });
});
