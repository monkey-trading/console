import { describe, expect, it } from "vitest";

import { MONKEY_UNIT } from "../format";
import type { OperatorRoute, RotationSetView, TurnRecordView, TurnView } from "../engine/stats-types";
import { operatorCells } from "./operator-cells";
import { withMembership } from "./operator-membership";
import { tableView, type OperatorRow } from "./operator-table";
import { isReassignment, recordState, rotationSet, rotationView, turnHistory, turnOf, TURNS_PAGE_LIMIT } from "./rotation";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";
/** The value `list` holds at `index`, which a test names because it built the list. */
function at<T>(list: readonly T[], index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error(`The list has nothing at ${index}.`);
  return found;
}
const KEY = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const SET: RotationSetView = {
  set: 3, epoch: 41, effective_at: 1_000, logged_at: 900,
  members: [
    { candidate: A, admin_key: KEY(1), weight: (500n * MONKEY_UNIT).toString() },
    { candidate: B.toUpperCase().replace("0X", "0x"), admin_key: KEY(2), weight: (300n * MONKEY_UNIT).toString() },
    { candidate: C, admin_key: KEY(3), weight: (200n * MONKEY_UNIT).toString() },
  ],
};
const TURN: TurnView = { turn: 7, position: 0, reason: "draw", set: 3, candidate: A, admin_key: KEY(1), applies_at: 5_000, taken: true };
const RECORD: TurnRecordView = {
  turn: 7, position: 0, reason: "draw", candidate: A, admin_key: KEY(1), assigned_seq: 40, assigned_ms: 4_000, applies_at: 5_000, refused: null, taken_seq: 41, taken_ms: 5_100, release: `0x${"11".repeat(32)}`,
};
const ROUTE: OperatorRoute = {
  operator: KEY(1), pending_rotation: null, rotation_enabled: true, last_election: null, rotation_set: SET, next_rotation_set: null, turn: TURN, next_turn: { ...TURN, turn: 8, candidate: B, admin_key: KEY(2), applies_at: 90_000, taken: false },
  turns: { records: [RECORD], next: null, truncated: false, retained_from_seq: 40 }, enclave: KEY(9), signer: { epoch: 4, address: KEY(9).toUpperCase().replace("0X", "0x") },
};

describe("rotationSet", () => {
  it("gives each member its weight over the set's as its expected share of turns, in basis points", () => {
    const set = rotationSet(SET);
    expect(set.members.map((member) => [member.address, member.turnShareBps])).toEqual([[A, 5_000], [B, 3_000], [C, 2_000]]);
    expect(set.totalWeight).toBe(1_000n * MONKEY_UNIT);
    expect(set).toMatchObject({ set: 3, epoch: 41, effectiveAtMs: 1_000 });
  });

  it("refuses a weight that is not a whole amount, an address that is not one, and a member named twice", () => {
    expect(() => rotationSet({ ...SET, members: [{ candidate: A, admin_key: KEY(1), weight: "1.5" }] })).toThrow(/weight/);
    expect(() => rotationSet({ ...SET, members: [{ candidate: "0xnope", admin_key: KEY(1), weight: "1" }] })).toThrow(/address/);
    expect(() => rotationSet({ ...SET, members: [at(SET.members, 0), { ...at(SET.members, 0), admin_key: KEY(5) }] })).toThrow(/twice/);
  });

  it("gives an empty set no shares", () => {
    expect(rotationSet({ ...SET, members: [] })).toMatchObject({ members: [], totalWeight: 0n });
  });
});

describe("rotationView", () => {
  it("reads today's and tomorrow's turns, the set, the history and the signer the vault names, lowercase", () => {
    const view = rotationView(ROUTE);
    expect(view.set?.set).toBe(3);
    expect(view.turn).toMatchObject({ turn: 7, candidate: A, appliesAtMs: 5_000, taken: true });
    expect(view.nextTurn).toMatchObject({ turn: 8, candidate: B, taken: false });
    expect(view.history.records).toHaveLength(1);
    expect(view.signer).toEqual({ epoch: 4, address: KEY(9) });
  });

  it("is empty for a node that predates the daily turns", () => {
    const { operator, pending_rotation, rotation_enabled, last_election } = ROUTE;
    expect(rotationView({ operator, pending_rotation, rotation_enabled, last_election })).toEqual({ set: null, nextSet: null, turn: null, nextTurn: null, history: { records: [], next: null, truncated: false }, signer: null });
  });

  it("takes null for an absent set or turn, as the node answers before the first set is mirrored", () => {
    expect(rotationView({ ...ROUTE, rotation_set: null, next_rotation_set: null, turn: null, next_turn: null })).toMatchObject({ set: null, nextSet: null, turn: null, nextTurn: null });
  });

  it("refuses a reason it does not know, a malformed turn number, and a signer that is not an address", () => {
    expect(() => turnOf({ ...TURN, reason: "bribe" as never })).toThrow(/reason/);
    expect(() => turnOf({ ...TURN, turn: -1 })).toThrow(/turn/);
    expect(() => rotationView({ ...ROUTE, signer: { epoch: 1, address: "0x12" } })).toThrow(/address/);
  });
});

describe("turnHistory", () => {
  it("keeps a refused assignment as a record with no time and its reason, and a taken one with its time", () => {
    const refused: TurnRecordView = { ...RECORD, turn: 8, assigned_seq: 50, applies_at: null, refused: "no set names its key", taken_seq: null, taken_ms: null, release: null };
    const { records } = turnHistory({ records: [refused, RECORD], next: 40, truncated: true });
    expect(records.map(recordState)).toEqual(["refused", "taken"]);
    expect(records[0]).toMatchObject({ appliesAtMs: null, refused: "no set names its key" });
    expect(records[1]?.takenMs).toBe(5_100);
  });

  it("calls a skip, a promotion and a refusal a reassignment, and a plain taken draw not one", () => {
    const records = [RECORD, { ...RECORD, reason: "skip" as const, position: 1 }, { ...RECORD, reason: "promotion" as const }, { ...RECORD, refused: "late" }];
    expect(turnHistory({ records, next: null, truncated: false }).records.map(isReassignment)).toEqual([false, true, true, true]);
  });

  it("carries the page's next and truncated marks, and refuses a page longer than the node's limit", () => {
    expect(turnHistory({ records: [RECORD], next: 40, truncated: true })).toMatchObject({ next: 40, truncated: true });
    expect(() => turnHistory({ records: Array.from({ length: TURNS_PAGE_LIMIT + 1 }, () => RECORD), next: null, truncated: false })).toThrow(/limit/);
  });
});

function row(address: string, hostname: string, overrides: Partial<OperatorRow> = {}): OperatorRow {
  return { address, hostname, registeredHostname: hostname, role: "candidate", listed: true, eligible: true, votes: 10n, shareBps: 0, bond: 1n, release: "", endpoint: null, registration: 0, membership: null, ...overrides };
}

describe("the operator table's membership columns", () => {
  const rows = [row(A, "a.example"), row(B, "b.example"), row(C, "c.example"), row(KEY(4), "d.example")];
  const set = rotationSet(SET);

  it("marks each row a member with its weight and share, and a row outside the set a non-member with none", () => {
    const decorated = withMembership(rows, set);
    expect(decorated.map((entry) => operatorCells(entry).membership)).toEqual(["Member", "Member", "Member", "Outside the set"]);
    expect(operatorCells(at(decorated, 0))).toMatchObject({ setWeight: "500 MONKEY", turnShare: "50.00%" });
    expect(operatorCells(at(decorated, 3))).toMatchObject({ setWeight: "—", turnShare: "—" });
  });

  it("knows no membership while no set is known", () => {
    expect(withMembership(rows, null).every((entry) => entry.membership === null)).toBe(true);
    expect(operatorCells(at(withMembership(rows, null), 0)).membership).toBe("—");
  });

  it("sorts by share of turns both ways with the rows with no set known ordered by address", () => {
    const decorated = withMembership(rows, set);
    expect(tableView(decorated, "", "turns-desc", 0).rows.map((entry) => entry.hostname)).toEqual(["a.example", "b.example", "c.example", "d.example"]);
    expect(tableView(decorated, "", "turns-asc", 0).rows.map((entry) => entry.hostname)).toEqual(["d.example", "c.example", "b.example", "a.example"]);
    // With no set known every weight is absent, so the address orders them.
    expect(tableView(withMembership(rows, null), "", "turns-desc", 0).rows.map((entry) => entry.hostname)).toEqual(["d.example", "a.example", "b.example", "c.example"]);
  });

  it("searches by membership, and by the weight and share of turns the columns show", () => {
    const decorated = withMembership(rows, set);
    expect(tableView(decorated, "outside the set", "role", 0).rows.map((entry) => entry.hostname)).toEqual(["d.example"]);
    // "member" finds the members only: the non-member's word does not contain it.
    expect(tableView(decorated, "member", "role", 0).rows.map((entry) => entry.hostname)).toEqual(["a.example", "b.example", "c.example"]);
    expect(tableView(decorated, "500 MONKEY", "role", 0).rows.map((entry) => entry.hostname)).toEqual(["a.example"]);
    expect(tableView(decorated, "30.00%", "role", 0).rows.map((entry) => entry.hostname)).toEqual(["b.example"]);
    // With no set known there is nothing of the rotation to find.
    expect(tableView(withMembership(rows, null), "member", "role", 0).matched).toBe(0);
  });
});
