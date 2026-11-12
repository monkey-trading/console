/** Tests for the mock's bucketing of the closes that fall inside a series bucket. */

import { describe, expect, it } from "vitest";

import { createMockNode } from "./index";
import { monkeySeries } from "./monkey";
import { START } from "./test-helpers";
import { within } from "./within";

/** A series read from `fromMs`, to the clock, a page of `limit`. */
function series(state: ReturnType<typeof createMockNode>["client"]["state"], query: { metric: "distributed_per_epoch"; resolution: "1h"; fromMs: number; limit: number }) {
  return monkeySeries(state, { market: null, toMs: Number.MAX_SAFE_INTEGER, ...query });
}

describe("within", () => {
  const times = [10, 20, 20, 30, 40];
  const at = (from: number, to: number) => within(times, (time) => time, from, to);

  it("returns the entries a filter on from <= time < to would, duplicates and the empty cases included", () => {
    for (const [from, to] of [[0, 5], [0, 10], [0, 11], [10, 20], [10, 21], [20, 30], [15, 35], [40, 41], [41, 99], [20, 20], [30, 10]] as const) {
      expect(at(from, to), `${from}..${to}`).toEqual(times.filter((time) => time >= from && time < to));
    }
    expect(within([], (time: number) => time, 0, 100)).toEqual([]);
  });

  it("gives every bucket of the series the closes inside it", () => {
    const state = createMockNode(START).client.state;
    const hour = 3_600_000;
    const page = series(state, { metric: "distributed_per_epoch", resolution: "1h", fromMs: START - 40 * hour, limit: 80 });
    expect(page.entries.length).toBeGreaterThan(0);
    for (const entry of page.entries) {
      const inside = state.monkey.epochs.filter((close) => close.closedMs >= entry.ts && close.closedMs < entry.ts + hour);
      expect("value" in entry ? entry.value : null).toBe(inside.reduce((sum, close) => sum + close.allocated, 0n).toString());
    }
  });
});
