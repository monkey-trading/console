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

  it("moves to the next day's turn when the clock passes the boundary", async () => {
    const { client } = createMockNode(SIM_EPOCH_MS);
    const before = await client.stats.operator();
    client.tick(client.state.now + DAY_MS);
    const after = await client.stats.operator();
    expect((after.turn?.turn ?? 0) - (before.turn?.turn ?? 0)).toBe(1);
    expect(after.turn?.applies_at).toBe(before.next_turn?.applies_at);
  });
});
