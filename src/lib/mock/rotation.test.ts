/** Tests for the simulated daily rotation the mock build's Rotation tab shows. */

import { describe, expect, it } from "vitest";

import { rotationView } from "../staking/rotation";
import { createMockNode, SIM_EPOCH_MS } from ".";

const DAY_MS = 86_400_000;

function route(params?: { before?: number; limit?: number }) {
  const { client } = createMockNode(SIM_EPOCH_MS);
  return { client, route: client.stats.operator(params) };
}

describe("the simulated rotation", () => {
  it("serves a route that passes the console's own check, with a set, two turns and a history", async () => {
    const view = rotationView(await route().route);
    expect(view.set?.members).toHaveLength(4);
    expect(view.turn?.taken).toBe(true);
    expect(view.nextTurn?.taken).toBe(false);
    expect(view.history.records.length).toBeGreaterThan(10);
  });

  it("gives today's turn to the operator in effect and tomorrow's turn the next boundary after it", async () => {
    const { client, route: read } = route();
    const answer = await read;
    expect(answer.turn?.candidate).toBe(client.state.operators.named(client.state.now).candidate);
    expect((answer.next_turn?.applies_at ?? 0) - (answer.turn?.applies_at ?? 0)).toBe(DAY_MS);
    // 22:30 UTC.
    expect(((answer.turn?.applies_at ?? 0) % DAY_MS) / 3_600_000).toBe(22.5);
  });

  it("keeps a skip, a promotion and a refused assignment in the history", async () => {
    const { records } = rotationView(await route({ limit: 100 }).route).history;
    expect(records.some((record) => record.reason === "skip" && record.refused === null)).toBe(true);
    expect(records.some((record) => record.reason === "promotion")).toBe(true);
    expect(records.some((record) => record.refused !== null && record.appliesAtMs === null)).toBe(true);
  });

  it("pages the history newest first by `before`, each page ending where the next begins, with no record twice", async () => {
    const { client } = createMockNode(SIM_EPOCH_MS);
    const seen: number[] = [];
    let before: number | undefined;
    for (let pages = 0; pages < 20; pages += 1) {
      const answer = await client.stats.operator({ limit: 5, ...(before === undefined ? {} : { before }) });
      const page = answer.turns?.records ?? [];
      expect(page.length).toBeLessThanOrEqual(5);
      seen.push(...page.map((record) => record.assigned_seq));
      const next = answer.turns?.next ?? null;
      if (next === null) break;
      before = next;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
    expect(seen.length).toBeGreaterThan(15);
  });

  it("signs each assignment from no earlier than it was made, and has its member take it no earlier than that", async () => {
    const records = (await route({ limit: 100 }).route).turns?.records ?? [];
    expect(records.some((record) => record.reason !== "draw" && record.taken_ms !== null)).toBe(true);
    for (const record of records) {
      const at = `turn ${record.turn} position ${record.position}`;
      if (record.applies_at !== null) expect(record.applies_at, at).toBeGreaterThanOrEqual(record.assigned_ms);
      if (record.taken_ms !== null) expect(record.taken_ms, at).toBeGreaterThanOrEqual(record.applies_at ?? Number.POSITIVE_INFINITY);
    }
  });

  it("draws the history across the whole set at the scale of MONKEY base units, not always its first member", async () => {
    const { records } = rotationView(await route({ limit: 100 }).route).history;
    expect(new Set(records.map((record) => record.candidate)).size).toBeGreaterThanOrEqual(3);
  });

  it("names, in its history, the member it names for today's and tomorrow's turns, each day of a fortnight", async () => {
    const { client } = createMockNode(SIM_EPOCH_MS);
    for (let day = 0; day < 14; day += 1) {
      const answer = await client.stats.operator({ limit: 100 });
      for (const turn of [answer.turn, answer.next_turn]) {
        if (turn === null || turn === undefined) throw new Error("the mock names both turns");
        const record = answer.turns?.records.find((candidate) => candidate.turn === turn.turn);
        expect(record && [record.candidate, record.admin_key, record.position, record.reason, record.applies_at], `day ${day}, turn ${turn.turn}`).toEqual([turn.candidate, turn.admin_key, turn.position, turn.reason, turn.applies_at]);
      }
      client.tick(client.state.now + DAY_MS);
    }
  });

  it("holds each set's times across reads, and takes the next set into effect at its time, drawing from it after", async () => {
    const { client } = createMockNode(SIM_EPOCH_MS);
    const first = await client.stats.operator();
    const nextAt = first.next_rotation_set?.effective_at ?? 0;
    expect(first.rotation_set?.set).toBe(3);
    client.tick(client.state.now + DAY_MS);
    const later = await client.stats.operator();
    expect([later.rotation_set?.effective_at, later.next_rotation_set?.effective_at]).toEqual([first.rotation_set?.effective_at, nextAt]);
    client.tick(nextAt + 1);
    const after = await client.stats.operator({ limit: 100 });
    expect([after.rotation_set?.set, after.rotation_set?.effective_at, after.next_rotation_set]).toEqual([4, nextAt, null]);
    const members = new Set(after.rotation_set?.members.map((member) => member.candidate));
    const drawnSince = (after.turns?.records ?? []).filter((record) => (record.applies_at ?? 0) >= nextAt && record.position === 0);
    expect(drawnSince.length).toBeGreaterThan(0);
    for (const record of drawnSince) expect(members.has(record.candidate), `turn ${record.turn}`).toBe(true);
  });

  it("times the sets from the demo node's clock start, not its backstory's, so the demo opens with a set to come", async () => {
    const { client } = createMockNode(SIM_EPOCH_MS, true);
    const answer = await client.stats.operator();
    expect([answer.rotation_set?.set, answer.next_rotation_set?.set, answer.next_rotation_set?.effective_at]).toEqual([3, 4, SIM_EPOCH_MS + 3 * DAY_MS]);
  });

  it("moves to the next day's turn when the clock passes the boundary", async () => {
    const { client } = createMockNode(SIM_EPOCH_MS);
    const before = await client.stats.operator();
    client.tick(client.state.now + DAY_MS);
    const after = await client.stats.operator();
    expect((after.turn?.turn ?? 0) - (before.turn?.turn ?? 0)).toBe(1);
    expect(after.turn?.applies_at).toBe(before.next_turn?.applies_at);
    // The member advertised for tomorrow is the one holding the turn once the boundary has passed.
    expect(after.turn?.candidate).toBe(before.next_turn?.candidate);
  });

  it("keeps each turn's seq, member and place in the history from one day's read to the next, and joins a newest page read after a boundary to an older page read before", async () => {
    const { client } = createMockNode(SIM_EPOCH_MS);
    const older = await client.stats.operator({ limit: 5, before: (await client.stats.operator({ limit: 5 })).turns?.next ?? 0 });
    const early = (await client.stats.operator({ limit: 100 })).turns?.records ?? [];
    client.tick(client.state.now + DAY_MS);
    const later = await client.stats.operator({ limit: 100 });
    const byTurn = new Map((later.turns?.records ?? []).map((record) => [`${record.turn}.${record.position}`, record]));
    for (const record of early) {
      const same = byTurn.get(`${record.turn}.${record.position}`);
      if (same === undefined) continue; // aged out of the window
      expect([same.assigned_seq, same.candidate, same.reason, same.refused]).toEqual([record.assigned_seq, record.candidate, record.reason, record.refused]);
    }
    expect(new Set(later.turns?.records.map((record) => record.assigned_seq)).size).toBe(later.turns?.records.length);
    // The newest page, read again a day on, ends at a cursor that names the turn the older page began after: no turn between them is missing.
    const newest = await client.stats.operator({ limit: 5 });
    const joined = [...(newest.turns?.records ?? []).map((record) => record.turn), ...(older.turns?.records ?? []).map((record) => record.turn)];
    const turns = [...new Set(joined)];
    for (const [index, turn] of turns.entries()) if (index > 0) expect(turn, `turn ${turn}`).toBe((turns[index - 1] ?? 0) - 1);
  });

  it("holds the skip, the promotion and the refusal on the same turns each day", async () => {
    const { client } = createMockNode(SIM_EPOCH_MS);
    const marks = async () => ((await client.stats.operator({ limit: 100 })).turns?.records ?? []).filter((record) => record.position > 0).map((record) => [record.turn, record.reason]);
    const first = await marks();
    expect(first.length).toBeGreaterThanOrEqual(3);
    client.tick(client.state.now + DAY_MS);
    expect(await marks()).toEqual(first);
  });

  it("keeps a turn's member through an election that takes effect mid-turn, and gives the elected operator the next boundary", async () => {
    const { client } = createMockNode(SIM_EPOCH_MS);
    const start = await client.stats.operator();
    const effectiveAt = start.pending_rotation?.effective_at ?? 0;
    const challenger = start.last_election?.candidate;
    // The day before the election, tomorrow's turn is advertised on the incumbent, and the election falls in the middle of the turn after it.
    client.state.now = effectiveAt - DAY_MS;
    const before = await client.stats.operator({ limit: 100 });
    expect(before.next_turn?.candidate).toBe(before.turn?.candidate);
    expect(before.next_turn?.applies_at).toBeLessThan(effectiveAt);
    client.state.now = effectiveAt + 1_000;
    const after = await client.stats.operator({ limit: 100 });
    expect(after.operator).not.toBe(before.operator);
    // The turn advertised keeps its member, its time and its place, now as today's turn.
    expect(after.turn?.turn).toBe(before.next_turn?.turn);
    expect([after.turn?.candidate, after.turn?.applies_at]).toEqual([before.next_turn?.candidate, before.next_turn?.applies_at]);
    for (const turn of [before.turn, before.next_turn]) {
      const kept = after.turns?.records.find((record) => record.turn === turn?.turn && record.position === 0);
      expect([kept?.candidate, kept?.applies_at]).toEqual([turn?.candidate, turn?.applies_at]);
    }
    // The change shows from the next boundary.
    expect(after.next_turn?.candidate).toBe(challenger);
    expect(after.next_turn?.applies_at).toBe((after.turn?.applies_at ?? 0) + DAY_MS);
  });
});
