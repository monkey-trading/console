/** Tests for which drops fall around a turn boundary at which the member changes, from the turns the node's signed route has named. */

import { describe, expect, it } from "vitest";

import type { EngineClient } from "./client";
import { NodeWord } from "./operator-follow-node";
import { FakeScheduler } from "./test-kit";

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
    expect(word.handoverWindow(T - 30_000 - 1)).toBeNull();
    expect(word.handoverWindow(T - 30_000)).toBe(T + 5 * MINUTE);
    expect(word.handoverWindow(T + 5 * MINUTE - 1)).toBe(T + 5 * MINUTE);
    expect(word.handoverWindow(T + 5 * MINUTE)).toBeNull();
  });

  it("gives a member half a turn to serve when turns are short, as the engine does, from the turn before it or the one after", async () => {
    const fromBefore = await heard([{ candidate: A, applies_at: T - 5 * MINUTE }, { candidate: B, applies_at: T }]);
    const fromAfter = await heard([null, { candidate: B, applies_at: T }], [{ candidate: B, applies_at: T }, { candidate: A, applies_at: T + 5 * MINUTE }]);
    for (const word of [fromBefore, fromAfter]) {
      expect(word.handoverWindow(T + 150_000 - 1)).toBe(T + 150_000);
      expect(word.handoverWindow(T + 150_000)).toBeNull();
    }
  });

  it("does not hold a drop at a boundary the same member holds on both sides of, and keeps the turns heard through a read that names fewer", async () => {
    const word = await heard([{ candidate: A, applies_at: T - 5 * MINUTE }, { candidate: A, applies_at: T }], [{ candidate: A, applies_at: T }, null]);
    expect(word.handoverWindow(T + 1_000)).toBeNull();
    // The earliest boundary heard has no member known before it, so it counts.
    expect(word.handoverWindow(T - 5 * MINUTE + 1_000)).not.toBeNull();
  });

  it("holds nothing before any route was read", () => {
    expect(new NodeWord(new FakeScheduler(), () => T).handoverWindow(T)).toBeNull();
  });
});
