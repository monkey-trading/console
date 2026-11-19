/** Tests for which drops fall around a turn boundary at which the member changes, from the turns the node's signed route has named. */

import { describe, expect, it } from "vitest";

import type { EngineClient } from "./client";
import { NodeWord } from "./operator-follow-node";
import { FakeScheduler } from "./test-kit";
import { RefusedAnswer, UnsignedAnswer } from "./trust-errors";

const MINUTE = 60_000;
const T = 10_000_000; // a boundary
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";

/** A node whose signed route names `turn` and `next`. */
const node = (turn: { candidate: string; applies_at: number } | null, next: { candidate: string; applies_at: number } | null) =>
  ({ stats: { operator: async () => ({ turn, next_turn: next, rotation_enabled: true }) } }) as unknown as EngineClient; // the read uses only the route

async function heard(...routes: Parameters<typeof node>[]): Promise<NodeWord> {
  const word = new NodeWord(new FakeScheduler(), () => T - 10 * MINUTE);
  for (const route of routes) await word.read(node(...route));
  return word;
}

describe("NodeWord.handoverWindow", () => {
  it("holds a drop from the clock tolerance before a boundary at which the member changes to the time its member may take to serve", async () => {
    const word = await heard([{ candidate: A, applies_at: T - 24 * 60 * MINUTE }, { candidate: B, applies_at: T }]);
    expect(word.handoverWindow(T - 30_000 - 1, 0)).toBeNull();
    expect(word.handoverWindow(T - 30_000, 0)).toBe(T + 5 * MINUTE);
    expect(word.handoverWindow(T + 5 * MINUTE - 1, 0)).toBe(T + 5 * MINUTE);
    expect(word.handoverWindow(T + 5 * MINUTE, 0)).toBeNull();
  });

  it("gives a member half a turn to serve when turns are short, as the engine does, from the turn before it or the one after", async () => {
    const fromBefore = await heard([{ candidate: A, applies_at: T - 5 * MINUTE }, { candidate: B, applies_at: T }]);
    const fromAfter = await heard([null, { candidate: B, applies_at: T }], [{ candidate: B, applies_at: T }, { candidate: A, applies_at: T + 5 * MINUTE }]);
    for (const word of [fromBefore, fromAfter]) {
      expect(word.handoverWindow(T + 150_000 - 1, 0)).toBe(T + 150_000);
      expect(word.handoverWindow(T + 150_000, 0)).toBeNull();
    }
  });

  it("does not hold a drop at a boundary the same member holds on both sides of, and keeps the turns heard through a read that names fewer", async () => {
    const word = await heard([{ candidate: A, applies_at: T - 5 * MINUTE }, { candidate: A, applies_at: T }], [{ candidate: A, applies_at: T }, null]);
    expect(word.handoverWindow(T + 1_000, 0)).toBeNull();
    // The earliest boundary heard has no member known before it, so it counts.
    expect(word.handoverWindow(T - 5 * MINUTE + 1_000, 0)).not.toBeNull();
  });

  it("holds nothing before any route was read", () => {
    expect(new NodeWord(new FakeScheduler(), () => T).handoverWindow(T, 0)).toBeNull();
  });

  it("does not hold a drop of the node that came into use at or after the boundary, the member it brought", async () => {
    const word = await heard([{ candidate: A, applies_at: T - 5 * MINUTE }, { candidate: B, applies_at: T }]);
    expect(word.handoverWindow(T + 1_000, T - 1)).not.toBeNull();
    expect(word.handoverWindow(T + 1_000, T)).toBeNull();
  });

  it("keeps the turns heard through a read of a node that is only not serving yet", async () => {
    const word = await heard([{ candidate: A, applies_at: T - 5 * MINUTE }, { candidate: B, applies_at: T }]);
    const unsigned = { stats: { operator: async () => { throw new RefusedAnswer("not signed", {} as never, { cause: new UnsignedAnswer("not signed") }); } } } as unknown as EngineClient; // the route plays no part
    await expect(word.read(unsigned)).resolves.toMatchObject({ read: false });
    expect(word.hostname({ turnAtMs: null, hostname: null, rotationEnabled: true, read: false, turns: [] }, T + 1_000)).toBeNull();
    expect(word.handoverWindow(T + 1_000, 0)).not.toBeNull();
  });
});
