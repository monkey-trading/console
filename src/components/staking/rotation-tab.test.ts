/** Tests for the Rotation tab and the operators card's turns: what each shows of the set, the turns and the history, and what it leaves hidden or says when the node cannot be read. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MONKEY_UNIT } from "@/lib/format";
import type { OperatorRoute, RotationSetView, TurnRecordView } from "@/lib/engine/stats-types";
import { LOADING, ready } from "@/lib/monkey/figures";
import type { OperatorsState } from "@/lib/monkey/operators";
import { rotationView } from "@/lib/staking/rotation";
import { TurnHistoryReads } from "@/lib/staking/turn-history-reads";
import type { ConsoleState } from "@/lib/store/state";
import { NO_EDITING } from "@/lib/staking/delegation-form";
import { NO_TABLE_VIEW } from "@/lib/staking/operator-table";

import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { StakingContext, type StakingReads } from "../StakingSection";
import { StakingRotation } from "./StakingRotation";
import { ALPHA, BRAVO, chain, delegationsLike, operatorsLike, render as renderOperators, VERIFIED, view } from "./operators-panel-kit";

const NOW = 1_793_000_000_000;
const DAY = 86_400_000;
const KEY = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const SET: RotationSetView = {
  set: 3, epoch: 41, effective_at: NOW - 8 * DAY, logged_at: NOW - 15 * DAY,
  members: [{ candidate: ALPHA, admin_key: KEY(1), weight: (700n * MONKEY_UNIT).toString() }, { candidate: BRAVO, admin_key: KEY(2), weight: (300n * MONKEY_UNIT).toString() }],
};
const record = (turn: number, over: Partial<TurnRecordView> = {}): TurnRecordView => ({
  turn, position: 0, reason: "draw", candidate: ALPHA, admin_key: KEY(1), assigned_seq: turn * 10, assigned_ms: NOW - 30 * 3_600_000, applies_at: NOW - 3_600_000, refused: null, taken_seq: turn * 10 + 5, taken_ms: NOW - 3_000_000, release: `0x${"11".repeat(32)}`, ...over,
});
const ROUTE: OperatorRoute = {
  operator: KEY(1), pending_rotation: null, rotation_enabled: true, last_election: null, rotation_set: SET,
  next_rotation_set: { ...SET, set: 4, epoch: 42, effective_at: NOW + 3 * DAY },
  turn: { turn: 9, position: 0, reason: "draw", set: 3, candidate: ALPHA, admin_key: KEY(1), applies_at: NOW - 3_600_000, taken: true },
  next_turn: { turn: 10, position: 0, reason: "draw", set: 3, candidate: BRAVO, admin_key: KEY(2), applies_at: NOW + 23 * 3_600_000, taken: false },
  turns: {
    records: [record(10, { candidate: BRAVO, admin_key: KEY(2), taken_seq: null, taken_ms: null, release: null, applies_at: NOW + 23 * 3_600_000 }), record(9), record(8, { position: 1, reason: "skip", candidate: BRAVO, admin_key: KEY(2) }), record(7, { refused: "no set names its key", applies_at: null, taken_seq: null, taken_ms: null, release: null, reason: "promotion" })],
    next: 70, truncated: false, retained_from_seq: 10,
  },
};
const loaded = (route: OperatorRoute = ROUTE): OperatorsState => ({ route: ready(route), rotation: rotationView(route), list: ready(view), held: null });

function Tab({ state, operators }: { state: Partial<ConsoleState>; operators: OperatorsState }) {
  const { store } = useSession();
  store.patch({ now: NOW, ...state });
  const reads = operatorsLike(operators);
  const stub = {
    operators: reads, turns: new TurnHistoryReads(store), delegations: delegationsLike(chain()), operatorsSettled: true, delegateEditing: NO_EDITING, setDelegateEditing: () => undefined,
    table: NO_TABLE_VIEW, setTable: () => undefined, typedSlot: false, setTypedSlot: () => undefined,
  } as unknown as StakingReads;
  return createElement(StakingContext.Provider, { value: stub }, createElement(StakingRotation));
}
const tab = (operators: OperatorsState, state: Partial<ConsoleState> = VERIFIED) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Tab, { state, operators })));

describe("the Rotation tab", () => {
  it("lists the set in effect with each member's weight and share of turns, and the next set with its time", () => {
    const html = tab(loaded());
    expect(html).toContain("Set in effect");
    expect(html).toContain("Set 3, adopted at registry epoch 41, 2 members; in effect since");
    expect(html).toContain("70.00%");
    expect(html).toContain("30.00%");
    expect(html).toContain("700 MONKEY");
    expect(html).toContain("Set 4, adopted at registry epoch 42, 2 members; takes effect at");
    expect(html).toContain("in 3d 0h");
  });

  it("names today's and tomorrow's turns, tomorrow's as not started", () => {
    const html = tab(loaded());
    expect(html).toContain("Today&#x27;s turn");
    expect(html).toMatch(/alpha\.example[^<]*, from [^<]*UTC<\/dd>/);
    expect(html).toMatch(/bravo\.example[^<]*, from [^<]*UTC, not started yet/);
  });

  it("lists the history newest first, with a skip, a promotion and a refusal with the engine's reason, apart under Skips and promotions", () => {
    const html = tab(loaded());
    const moves = html.slice(html.indexOf("Skips and promotions"), html.indexOf("Turn history"));
    expect(moves).toContain("Skip");
    expect(moves).toContain("Promotion");
    expect(moves).toContain("Refused: no set names its key. The key in effect stayed.");
    expect(moves.match(/Taken at/g)).toHaveLength(1);
    const history = html.slice(html.indexOf("Turn history"));
    expect(history.indexOf("tabular-nums\">10<")).toBeLessThan(history.indexOf("tabular-nums\">9<"));
    expect(history).toContain("Load older");
  });

  it("offers no Load older at the history's end, and says what a truncated history holds", () => {
    const end = { ...ROUTE, turns: { records: ROUTE.turns?.records ?? [], next: null, truncated: true, retained_from_seq: 10 } };
    const html = tab(loaded(end));
    expect(html).not.toContain("Load older");
    expect(html).toContain("The node keeps only its newest turns");
  });

  it("says no set is in effect, and no later one, from a node that mirrors none", () => {
    const html = tab(loaded({ ...ROUTE, rotation_set: null, next_rotation_set: null, turn: null, next_turn: null, turns: { records: [], next: null, truncated: false, retained_from_seq: null } }));
    expect(html).toContain("No rotation set is in effect.");
    expect(html).toContain("No later set has been mirrored.");
    expect(html).toContain("No turn is in effect");
    expect(html).toContain("Not drawn yet");
    expect(html).toContain("No turn has been assigned yet.");
  });

  it("shows a dash for each figure and a reading line before the first read lands, and hides its figures while the node is not trusted", () => {
    const pending = tab({ route: LOADING, rotation: null, list: LOADING, held: null });
    expect(pending).toContain("Reading the node&#x27;s rotation…");
    expect(pending).not.toContain("Turn history");
    const untrusted = tab(loaded(), { ...VERIFIED, attestation: { kind: "unverified", reason: "no" } });
    expect(untrusted).toContain('class="mt-4 hidden gap-4"');
  });
});

describe("the Rotation tab without a rotation", () => {
  it("says the rotation is not read, rather than that it is being read, from a node that does not serve it or whose read failed", () => {
    for (const route of [{ status: "unavailable" as const, value: null, message: null }, { status: "failed" as const, value: null, message: "the node is busy" }]) {
      const html = tab({ route, rotation: null, list: LOADING, held: null });
      expect(html).toContain("The node&#x27;s rotation is not read.");
      expect(html).not.toContain("Reading the node&#x27;s rotation…");
    }
  });
});

describe("the operators card's turns", () => {
  it("shows today's and tomorrow's turns beside the operator in effect, and dashes before the route is read", () => {
    const html = renderOperators({ state: VERIFIED, operators: loaded(), read: chain() });
    expect(html).toMatch(/Today&#x27;s turn<\/dt><dd[^>]*>alpha\.example[^<]*, from /);
    expect(html).toMatch(/Tomorrow&#x27;s turn<\/dt><dd[^>]*>bravo\.example[^<]*, not started yet/);
    const before = renderOperators({ state: VERIFIED, operators: { route: LOADING, rotation: null, list: ready(view), held: null }, read: chain() });
    expect(before).toMatch(/Today&#x27;s turn<\/dt><dd[^>]*>—</);
  });

  it("marks each member in the operator table and gives its weight and share of turns", () => {
    const html = renderOperators({ state: VERIFIED, operators: loaded(), read: chain() });
    expect(html).toContain("Rotation set");
    expect(html).toContain("Share of turns");
    expect(html).toContain("70.00%");
    expect(html).toContain("Member");
  });
});
