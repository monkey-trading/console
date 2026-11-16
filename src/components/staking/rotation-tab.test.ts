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
import { formatStamp } from "@/lib/time";

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
    records: [record(10, { candidate: BRAVO, admin_key: KEY(2), taken_seq: null, taken_ms: null, release: null, applies_at: NOW + 23 * 3_600_000 }), record(9), record(8, { position: 1, reason: "skip", candidate: BRAVO, admin_key: KEY(2), applies_at: NOW - 25 * 3_600_000, taken_ms: NOW - 25 * 3_600_000 + 20_000 }), record(7, { refused: "no set names its key", applies_at: null, taken_seq: null, taken_ms: null, release: null, reason: "promotion" })],
    next: 70, truncated: false, retained_from_seq: 10,
  },
};
const loaded = (route: OperatorRoute = ROUTE, list = view): OperatorsState => ({ route: ready(route), rotation: rotationView(route), list: ready(list), held: null });
const KEPT = "The operator already running the trading server stays in place.";
/** The tab's cards from `title` to the next card's title, or to the tab's closing note. */
const card = (html: string, title: string, next = "The trading server is run in turns") => html.slice(html.indexOf(title), html.indexOf(next, html.indexOf(title)));

function Tab({ state, operators }: { state: Partial<ConsoleState>; operators: OperatorsState }) {
  const { store } = useSession();
  store.patch({ now: NOW, ...state });
  const reads = operatorsLike(operators);
  // The tab reads only `operators` and `turns`; the rest fills the shape with inert values.
  const stub = {
    operators: reads, turns: new TurnHistoryReads(store), delegations: delegationsLike(chain()), operatorsSettled: true, delegateEditing: NO_EDITING, setDelegateEditing: () => undefined,
    table: NO_TABLE_VIEW, setTable: () => undefined, typedSlot: false, setTypedSlot: () => undefined,
  } as unknown as StakingReads;
  return createElement(StakingContext.Provider, { value: stub }, createElement(StakingRotation));
}
const tab = (operators: OperatorsState, state: Partial<ConsoleState> = VERIFIED) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Tab, { state, operators })));

describe("the Rotation tab", () => {
  it("lists the current group with each member's weight and share of turns, and the next group with when it takes over, in plain words", () => {
    const html = tab(loaded());
    expect(html).toContain("Current operator group");
    expect(html).toContain("The current group has 2 operators, listed below, and has run the trading server in turns since");
    expect(html).toContain("70.00%");
    expect(html).toContain("30.00%");
    expect(html).toContain("700 MONKEY");
    expect(html).toMatch(/The next group has 2 operators, listed below, and takes over from the current group at [^<]*, in 3 days\. Until then, the current group continues to run the trading server\./);
    expect(html).not.toMatch(/Rotation \d|election \d|position \d/);
  });

  it("before the next group is chosen, says when the registry's next election is due to close", () => {
    const html = tab(loaded({ ...ROUTE, next_rotation_set: null }, { ...view, nextElectionMs: NOW + 5 * 3_600_000 }));
    expect(html).toMatch(/The next group of operators has not yet been chosen\. It will be chosen at the next election, which is due to close at [^<]*UTC, in 5 hours[^.<]*\. A group takes over about seven days after the election that chooses it, and the current group continues to run the trading server until then\./);
  });

  it("names the current and next turns, the next as not started", () => {
    const html = tab(loaded());
    expect(html).toMatch(/Current turn<\/dt>.*?alpha\.example[^<]*, from [^<]*UTC<\/span>/);
    expect(html).toMatch(/Next turn<\/dt>.*?bravo\.example[^<]*, from [^<]*UTC, not yet started<\/span>/);
    expect(html).not.toContain("Today&#x27;s turn");
  });

  it("lays out the groups, the turn history and the reassigned and refused turns in that order in one grid", () => {
    const html = tab(loaded());
    const grid = html.slice(html.indexOf('<div class="grid items-start gap-4 xl:grid-cols-2">'));
    const order = ["Current operator group", "Next operator group", "Turn history", "Reassigned and refused turns", "The trading server is run in turns"].map((title) => grid.indexOf(title));
    expect(order.every((at, i) => at > 0 && (i === 0 || at > (order[i - 1] ?? 0)))).toBe(true);
  });

  it("shows who ran the trading server from each takeover until the next, the latest until now, with the upcoming turn apart", () => {
    const history = card(tab(loaded()), "Turn history", "Reassigned and refused turns");
    const upcoming = history.slice(history.indexOf("Upcoming"));
    expect(upcoming).toMatch(new RegExp(`${formatStamp(NOW + 23 * 3_600_000)}.*bravo\\.example.*Draw.*Scheduled`));
    const periods = history.slice(history.indexOf("Each operator that ran the trading server"), history.indexOf("Upcoming"));
    expect(periods).toMatch(new RegExp(`${formatStamp(NOW - 3_000_000)}.*Now.*alpha\\.example.*Operator key 0x000000…0001.*Scheduled hand-over`));
    expect(periods).toMatch(new RegExp(`${formatStamp(NOW - 25 * 3_600_000 + 20_000)}.*${formatStamp(NOW - 3_000_000)}.*bravo\\.example.*Skip`));
    expect(periods.indexOf("alpha.example")).toBeLessThan(periods.indexOf("bravo.example"));
    expect(history).toContain("Load older");
  });

  it("lists a skip, a promotion and a refusal in plain words under Reassigned and refused turns", () => {
    const moves = card(tab(loaded()), "Reassigned and refused turns");
    expect(moves).toContain("Skip");
    expect(moves).toContain("Promotion");
    expect(moves).toContain(`Refused. The operator assigned the turn could not take over. ${KEPT}`);
    expect(moves.match(/Started at/g)).toHaveLength(1);
  });

  it("shows a refused short turn by its start time with the engine's notice reason in plain words, never its turn number or position", () => {
    const SHORT = Date.UTC(2026, 10, 16, 21, 50);
    const refused = record(5_982_886, { position: 1, assigned_ms: SHORT - 240_000, applies_at: null, refused: `set 1 was logged at ${SHORT - 120_000}, less than one turn before the turn applies at ${SHORT}`, taken_seq: null, taken_ms: null, release: null });
    const before = record(5_982_885, { assigned_ms: SHORT - 600_000, applies_at: SHORT - 300_000, taken_ms: SHORT - 290_000 });
    const html = tab(loaded({ ...ROUTE, turns: { records: [refused, before], next: null, truncated: false, retained_from_seq: null } }));
    // The operator that kept running the server through it says so in its period.
    expect(card(html, "Turn history", "Reassigned and refused turns")).toContain("The operator continued to run the trading server through the turn due at 16 Nov 21:50:00 UTC, which was refused.");
    const moves = card(html, "Reassigned and refused turns");
    expect(moves).toContain("2026-11-16 21:50");
    expect(moves).toContain(`Refused. An operator must be announced at least one turn before its turn begins, and the operator assigned the turn was announced later than that. ${KEPT}`);
    expect(moves).not.toMatch(/5982886|position/);
  });

  it("offers no Load older at the history's end, says what a truncated history holds, and holds both lines' places either way", () => {
    const end = { ...ROUTE, turns: { records: ROUTE.turns?.records ?? [], next: null, truncated: true, retained_from_seq: 10 } };
    const html = tab(loaded(end));
    expect(html).not.toMatch(/<button[^>]*>(Load older|Loading)/);
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*\binvisible\b[^"]*">Load older<\/span>/);
    expect(html).toMatch(/<p class="(?![^"]*\binvisible\b)[^"]*">Only the most recent turns are retained/);
    const whole = tab(loaded({ ...end, turns: { ...end.turns, truncated: false } }));
    expect(whole).toMatch(/<p aria-hidden="true" class="[^"]*\binvisible\b[^"]*">Only the most recent turns are retained/);
  });

  it("says no set is in effect, and no later one, from a node that mirrors none", () => {
    const html = tab(loaded({ ...ROUTE, rotation_set: null, next_rotation_set: null, turn: null, next_turn: null, turns: { records: [], next: null, truncated: false, retained_from_seq: null } }));
    expect(html).toContain("No group of operators is running the trading server in turns.");
    expect(html).toContain("The next group of operators has not yet been chosen. It will be chosen when the current election is closed, which has been due since");
    expect(html).toContain("No turn in progress");
    expect(html).toContain("Not yet drawn");
    expect(html).toContain("No upcoming turn has been drawn yet.");
    expect(html).toContain("No operator has taken over a turn yet.");
  });

  it("shows a dash for each figure and a reading line before the first read lands, and hides its figures while the node is not trusted", () => {
    const pending = tab({ route: LOADING, rotation: null, list: LOADING, held: null });
    expect(pending).toContain("Loading the rotation…");
    // The cards are there from the first paint, so nothing moves when the read lands, and none claims an empty history.
    expect(pending).toContain("Turn history");
    expect(pending).not.toMatch(/No operator has taken over a turn yet|No upcoming turn has been drawn yet/);
    const untrusted = tab(loaded(), { ...VERIFIED, attestation: { kind: "unverified", reason: "no" } });
    expect(untrusted).toContain('class="mt-4 hidden gap-4"');
  });
});

describe("the Rotation tab without a rotation", () => {
  it("says the rotation is not read, rather than that it is being read, from a node that does not serve it or whose read failed", () => {
    for (const route of [{ status: "unavailable" as const, value: null, message: null }, { status: "failed" as const, value: null, message: "the node is busy" }]) {
      const html = tab({ route, rotation: null, list: LOADING, held: null });
      expect(html).toContain("The rotation could not be loaded.");
      expect(html).not.toContain("Loading the rotation…");
    }
  });
});

describe("the operators card's turns", () => {
  it("shows the current and next turns beside the operator in effect, and dashes before the route is read", () => {
    const html = renderOperators({ state: VERIFIED, operators: loaded(), read: chain() });
    expect(html).toMatch(/Current turn<\/dt>.*?alpha\.example[^<]*, from /);
    expect(html).toMatch(/Next turn<\/dt>.*?bravo\.example[^<]*, not yet started/);
    const before = renderOperators({ state: VERIFIED, operators: { route: LOADING, rotation: null, list: ready(view), held: null }, read: chain() });
    expect(before).toMatch(/Current turn<\/dt>.*?justify-self-end">—<\/span>/);
  });

  it("marks each member in the operator table and gives its weight and share of turns", () => {
    const html = renderOperators({ state: VERIFIED, operators: loaded(), read: chain() });
    expect(html).toContain("In rotation");
    expect(html).toContain("Share of turns");
    expect(html).toContain("70.00%");
    expect(html).toContain("Yes");
  });
});
