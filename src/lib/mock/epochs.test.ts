/** Tests for the mock's `GET /v1/monkey/distributions`: its closed epochs, paged as the node pages them, each as its close recorded it. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { MONKEY_UNIT } from "../format";
import { createMockNode } from "./index";
import { distributionEpochsPage, stake } from "./monkey";
import { advance } from "./step";
import { START } from "./test-helpers";

function node() {
  return createMockNode(START).client.state;
}

describe("the mock's closed epochs", () => {
  it("serves its closed epochs newest first, paged by the epoch before which a page ends, as GET /v1/monkey/distributions does", () => {
    const state = node();
    const count = state.monkey.epochs.length;
    const newest = state.monkey.epochs[count - 1];
    const first = distributionEpochsPage(state, { limit: 2 });
    expect(first.epochs.map((close) => close.epoch)).toEqual([newest?.epoch, (newest?.epoch ?? 0) - 1]);
    expect(first.epochs[0]).toMatchObject({ close_ms: newest?.closedMs, stakers_usdc_units: newest?.allocated.toString(), skipped: null });
    expect(first.next).toBe((newest?.epoch ?? 0) - 1);
    const rest = distributionEpochsPage(state, { before: first.next ?? 0, limit: 200 });
    expect(rest.epochs[0]?.epoch).toBe((first.next ?? 0) - 1);
    const oldest = state.monkey.epochs[0]?.epoch ?? 0;
    expect(distributionEpochsPage(state, { before: oldest + 1, limit: 200 })).toMatchObject({ epochs: [{ epoch: oldest }], next: null });
    expect(count).toBeGreaterThan(200);
    expect(() => distributionEpochsPage(state, { limit: 201 })).toThrow(EngineError);
  });

  it("serves each close as it was recorded, with the operator's fifth beside the stakers' four fifths, whatever happens after", () => {
    const state = node();
    const paid = [...state.monkey.epochs].reverse().find((close) => close.allocated > 0n);
    if (paid === undefined) throw new Error("the mock's history pays stakers");
    const read = () => distributionEpochsPage(state, { before: paid.epoch + 1, limit: 1 }).epochs[0];
    const before = read();
    expect(before?.operator_shares).toEqual([{ account: state.operators.candidates[0]?.address, amount: (paid.allocated / 4n).toString() }]);
    expect(BigInt(before?.allocated_usdc_units ?? "0")).toBe(paid.allocated + paid.allocated / 4n);
    state.monkey.seededBalance.set("0x00000000000000000000000000000000000000ab", 10n * MONKEY_UNIT);
    stake(state, "0x00000000000000000000000000000000000000ab", MONKEY_UNIT);
    advance(state, state.now + 60_000);
    expect(read()).toEqual(before);
  });

});
