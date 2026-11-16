/** Tests for the chart's bars across a move to the next operator's server (monkey-trading/console#426): the bars shown stay, and the new server's shorter history merges into them. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settle } from "../engine/test-kit";
import type { MarkProvenance } from "../engine/mark-types";
import { setup } from "./live-fake";
import { moveToNode } from "./node-move";

const T0 = Date.UTC(2026, 10, 16, 22, 0, 0);
const MIN = 60_000;
const entry = (ts: number, price: number, provenance: MarkProvenance = "log_derived") => ({ ts, open: String(price), high: String(price), low: String(price), close: String(price), provenance });
const minutes = (bars: readonly { time: number }[]) => bars.map((bar) => (bar.time * 1000 - T0) / MIN);

/** The last server's store, seeded with half an hour of 1m marks and shown at `T0`. */
async function shown(provenance: MarkProvenance = "log_derived") {
  const old = setup();
  old.client.marksPages = [{ entries: [entry(T0 - 30 * MIN, 99_000, provenance), entry(T0 - 20 * MIN, 99_500, provenance), entry(T0 - 10 * MIN, 100_500, provenance), entry(T0 - 5 * MIN, 100_000, provenance)], next: null }];
  old.store.start(T0);
  await settle();
  return old;
}

/** The next server, whose history begins inside the bucket at `T0`: one 1m mark there and one the minute after. */
function next() {
  const moved = setup();
  moved.client.marksPages = [{ entries: [entry(T0, 101_000), entry(T0 + MIN, 102_000)], next: null }];
  return moved;
}

describe("the chart's bars across a move to another server", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps every bar the last server's store showed and merges the next server's shorter history into them", async () => {
    const old = await shown();
    const held = old.store.getSnapshot().bars[1]?.["1m"] ?? [];
    expect(minutes(held)).toEqual([-30, -20, -10, -5, 0]);
    const moved = next();
    await moveToNode(old.store, moved.store);
    moved.store.start(T0 + 2 * MIN);
    await settle();
    const bars = moved.store.getSnapshot().bars[1]?.["1m"] ?? [];
    expect(moved.client.marksReads).toHaveLength(1);
    expect(bars.length).toBeGreaterThan(held.length);
    expect(bars.slice(0, 4)).toEqual(held.slice(0, 4));
    // The next server saw only part of the bucket at T0: it keeps the open shown, and takes the wider range and the later close.
    const atT0 = held[4];
    expect(bars[4]).toEqual({ ...atT0, high: 101_000, close: 101_000, observedHigh: 101_000 });
    expect(minutes(bars)).toEqual([-30, -20, -10, -5, 0, 1, 2]);
    expect(bars[5]).toMatchObject({ open: 102_000, close: 102_000 });
  });

  it("keeps the carried bars through a restart of the new store, as StrictMode makes", async () => {
    const old = await shown();
    const held = old.store.getSnapshot().bars[1]?.["1m"] ?? [];
    const moved = next();
    await moveToNode(old.store, moved.store);
    const stop = moved.store.start(T0 + 2 * MIN);
    stop();
    moved.store.start(T0 + 2 * MIN);
    await settle();
    expect((moved.store.getSnapshot().bars[1]?.["1m"] ?? []).slice(0, 4)).toEqual(held.slice(0, 4));
  });

  it("still says a series holds provider-seeded history after the next server's marks, derived from its own log, merge in", async () => {
    const old = await shown("seeded_from_provider");
    const moved = next();
    await moveToNode(old.store, moved.store);
    moved.store.start(T0 + 2 * MIN);
    await settle();
    expect(moved.store.getSnapshot().barProvenance[1]?.["1m"]).toBe("seeded_from_provider");
  });
});
