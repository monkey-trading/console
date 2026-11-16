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
    expect(setLine(SET, EFFECTIVE - 3 * 86_400_000)).toBe("Rotation 4, chosen at election 42, with 2 operators. Starts at 18 Nov 22:30:00 UTC, in 3d 0h.");
  });

  it("says since when a set is in effect once its time has come, and with no clock read yet, and counts one member as one", () => {
    expect(setLine(SET, EFFECTIVE)).toBe("Rotation 4, chosen at election 42, with 2 operators. Running since 18 Nov 22:30:00 UTC.");
    expect(setLine({ ...SET, members: [member("0xa")] }, 0)).toBe("Rotation 4, chosen at election 42, with 1 operator. Running since 18 Nov 22:30:00 UTC.");
  });
});

describe("a record's words", () => {
  it("says when its key signs from, and a dash for an assignment the engine refused", () => {
    expect(recordFrom(RECORD)).toBe("2026-11-18 22:30");
    expect(recordFrom({ ...RECORD, appliesAtMs: null, refused: "no set names its key" })).toBe("—");
  });

  it("says a refused assignment kept the key, a taken one when, and one not taken yet that its member has not started it", () => {
    expect(recordOutcome({ ...RECORD, appliesAtMs: null, refused: "no set names its key" })).toBe("Refused: no set names its key. The current operator carried on.");
    expect(recordOutcome({ ...RECORD, takenMs: EFFECTIVE + 4_000 })).toBe("Started at 2026-11-18 22:30 UTC");
    expect(recordOutcome(RECORD)).toBe("Assigned, not started yet");
  });
});
