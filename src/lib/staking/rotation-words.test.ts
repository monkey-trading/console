/** Tests for what the Rotation tab says of a set and of each turn record (monkey-trading/console#280). */

import { describe, expect, it } from "vitest";

import type { RotationSet, TurnRecord } from "./rotation";
import { recordFrom, recordOutcome, setLine } from "./rotation-words";

const EFFECTIVE = Date.UTC(2026, 10, 18, 22, 30);
const member = (address: string) => ({ address, adminKey: address, weight: 1n, turnShareBps: 5_000 });
const SET: RotationSet = { set: 4, epoch: 42, effectiveAtMs: EFFECTIVE, members: [member("0xa"), member("0xb")], totalWeight: 2n };
const RECORD: TurnRecord = { turn: 9, position: 0, reason: "draw", candidate: "0xa", appliesAtMs: EFFECTIVE, refused: null, assignedSeq: 10, assignedMs: EFFECTIVE - 3_600_000, takenMs: null };

describe("setLine", () => {
  it("says when a set takes effect and the wait, while that is ahead", () => {
    expect(setLine(SET, EFFECTIVE - 3 * 86_400_000)).toBe("Rotation 4 was chosen at election 42 and has 2 operators. It starts at 18 Nov 22:30:00 UTC, in 3 days.");
  });

  it("says since when a set is in effect once its time has come, and with no clock read yet, and counts one member as one", () => {
    expect(setLine(SET, EFFECTIVE)).toBe("Rotation 4 was chosen at election 42 and has 2 operators. It has been running since 18 Nov 22:30:00 UTC.");
    expect(setLine({ ...SET, members: [member("0xa")] }, 0)).toBe("Rotation 4 was chosen at election 42 and has 1 operator. It has been running since 18 Nov 22:30:00 UTC.");
  });
});

describe("a record's words", () => {
  it("says when its key signs from, and a dash for an assignment the engine refused", () => {
    expect(recordFrom(RECORD)).toBe("2026-11-18 22:30");
    expect(recordFrom({ ...RECORD, appliesAtMs: null, refused: "no set names its key" })).toBe("—");
  });

  it("says a refused assignment kept the key, a taken one when, and one not taken yet that its member has not started it", () => {
    expect(recordOutcome({ ...RECORD, appliesAtMs: null, refused: "no set names its key" })).toBe("Refused. The turn could not take effect, so the current operator continued.");
    expect(recordOutcome({ ...RECORD, appliesAtMs: null, refused: "turn 812 ended before its assignment was mirrored" })).toBe("Refused, because the turn had already ended when it was recorded. The current operator continued.");
    expect(recordOutcome({ ...RECORD, appliesAtMs: null, refused: "set 3 is not among the sets mirrored" })).toBe("Refused, because the rotation it was drawn from had not been recorded. The current operator continued.");
    expect(recordOutcome({ ...RECORD, appliesAtMs: null, refused: "set 3 does not name candidate 0xab with key 0xcd" })).toBe("Refused, because the rotation it was drawn from does not name this operator with this key. The current operator continued.");
    expect(recordOutcome({ ...RECORD, appliesAtMs: null, refused: "set 3 was logged at 5, less than seven days before the turn applies at 9" })).toBe("Refused, because its operator was not named in a rotation announced at least seven days earlier. The current operator continued.");
    expect(recordOutcome({ ...RECORD, appliesAtMs: null, refused: "no set mirrored seven days earlier names its key" })).toBe("Refused, because its operator was not named in a rotation announced at least seven days earlier. The current operator continued.");
    expect(recordOutcome({ ...RECORD, takenMs: EFFECTIVE + 4_000 })).toBe("Started at 2026-11-18 22:30 UTC");
    expect(recordOutcome(RECORD)).toBe("Assigned but not yet started");
  });
});
