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
});
