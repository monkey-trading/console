/** Tests for the turn history as who ran the trading server and when (monkey-trading/console#435). */

import { describe, expect, it } from "vitest";

import type { TurnRecord } from "./rotation";
import { keptLine, operatingHistory, periodEnd, upcomingStatus } from "./turn-periods";

const TURN_MS = 300_000;
/** Turn 5982902 of a development build's five-minute turns begins at 23:10 UTC on 16 November 2026. */
const T = 5_982_902;
const START = Date.UTC(2026, 10, 16, 23, 10);
const at = (turn: number) => START + (turn - T) * TURN_MS;
let seq = 0;
/** A draw of `turn` for `candidate`, logged a turn ahead, taken `takenAfterMs` after its start (null: not taken). */
function drawn(turn: number, candidate: string, takenAfterMs: number | null, over: Partial<TurnRecord> = {}): TurnRecord {
  seq += 10;
  return {
    turn, position: 0, reason: "draw", candidate, adminKey: candidate, appliesAtMs: at(turn), refused: null,
    assignedSeq: seq, assignedMs: at(turn) - TURN_MS, takenMs: takenAfterMs === null ? null : at(turn) + takenAfterMs, ...over,
  };
}
const refused = (turn: number, candidate: string): TurnRecord => drawn(turn, candidate, null, { appliesAtMs: null, refused: "set 1 was logged at 1, less than one turn before the turn applies at 2" });

describe("operatingHistory", () => {
  it("makes each takeover a period running until the next takeover, newest first, the latest running now", () => {
    const records = [drawn(T + 1, "0xb", 20_000), drawn(T, "0xa", 15_000), drawn(T - 1, "0xc", 4_000)];
    const { periods } = operatingHistory(records);
    expect(periods.map(({ record, fromMs, toMs }) => [record.candidate, fromMs, toMs])).toEqual([
      ["0xb", at(T + 1) + 20_000, null],
      ["0xa", START + 15_000, at(T + 1) + 20_000],
      ["0xc", at(T - 1) + 4_000, START + 15_000],
    ]);
    expect(periodEnd(periods[0] ?? { record: drawn(T, "0xa", 0), fromMs: 0, toMs: null, kept: [] })).toBe("Now");
    expect(periodEnd(periods[1] ?? { record: drawn(T, "0xa", 0), fromMs: 0, toMs: 0, kept: [] })).toBe("16 Nov 23:15:20");
  });

  it("keeps drawn turns not yet taken over apart as upcoming, soonest first, a due one among them", () => {
    const records = [drawn(T + 2, "0xc", null), drawn(T + 1, "0xb", null), drawn(T, "0xa", 15_000)];
    const { periods, upcoming } = operatingHistory(records);
    expect(periods.map(({ record }) => record.turn)).toEqual([T]);
    expect(upcoming.map((record) => record.turn)).toEqual([T + 1, T + 2]);
    expect(upcomingStatus(drawn(T + 1, "0xb", null), at(T + 1) - 1)).toBe("Scheduled");
    expect(upcomingStatus(drawn(T + 1, "0xb", null), at(T + 1) + 5_000)).toBe("Due, not yet taken over");
  });

  it("puts a refused turn, and one whose operator never took over, in the period of the operator that kept running the server", () => {
    const records = [drawn(T + 3, "0xb", 10_000), drawn(T + 2, "0xc", null), refused(T + 1, "0xc"), drawn(T, "0xa", 15_000)];
    const { periods, upcoming } = operatingHistory(records);
    expect(upcoming).toEqual([]);
    expect(periods.map(({ record, kept }) => [record.candidate, kept])).toEqual([
      ["0xb", []],
      ["0xa", [{ atMs: at(T + 1), refused: true }, { atMs: at(T + 2), refused: false }]],
    ]);
    expect(keptLine({ atMs: at(T + 1), refused: true })).toBe("The operator continued to run the trading server through the turn due at 16 Nov 23:15:00 UTC, which was refused.");
    expect(keptLine({ atMs: at(T + 2), refused: false })).toBe("The operator continued to run the trading server through the turn due at 16 Nov 23:20:00 UTC, as the operator assigned to it did not take over.");
  });

  it("counts a turn taken by a skip or a promotion as run, whatever happened to its other assignments", () => {
    const skip = drawn(T, "0xb", 90_000, { position: 1, reason: "skip", appliesAtMs: START + 80_000 });
    const lateRefusal = { ...refused(T, "0xc"), reason: "promotion" as const, assignedMs: START + 120_000 };
    const { periods, upcoming } = operatingHistory([lateRefusal, skip, drawn(T, "0xa", null), drawn(T - 1, "0xd", 2_000)]);
    expect(periods.map(({ record, kept }) => [record.candidate, record.reason, kept.length])).toEqual([["0xb", "skip", 0], ["0xd", "draw", 0]]);
    expect(upcoming).toEqual([]);
  });
});
