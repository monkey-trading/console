/** Tests for the simulated registry: what the mock build's MONKEY page shows of candidates and an election. */

import { describe, expect, it } from "vitest";

import { NO_CANDIDATE } from "../engine/registry";
import { MONKEY_UNIT } from "../format";
import { createMockNode, SIM_EPOCH_MS } from ".";
import { stake } from "./monkey";

const ME = "0x00000000000000000000000000000000000000aa";

function node() {
  const { client, controls } = createMockNode(SIM_EPOCH_MS);
  const { state } = client;
  state.monkey.seededBalance.set(ME, 1_000_000n * MONKEY_UNIT);
  stake(state, ME, 500_000n * MONKEY_UNIT);
  return { client, controls, state, reads: controls.chainReads() };
}

describe("the simulated registry", () => {
  it("names an operator in effect with its hostname, and an election waiting out its notice", async () => {
    const { reads, state } = node();
    const named = await reads.operator();
    expect(named).toMatchObject({ rotationEnabled: true, hostname: "alpha.operators.example" });
    expect(named?.pending?.effectiveAtMs).toBe(state.now + 6 * 86_400_000);
    const table = await reads.candidates();
    expect(table?.candidates.find((c) => c.address === named?.pending?.candidate)?.hostname).toBe("bravo.operators.example");
  });

  it("lists eligible and ineligible candidates against the total stake", async () => {
    const table = await node().reads.candidates();
    expect(table?.candidates.map((c) => [c.hostname.split(".")[0], c.eligible])).toEqual([["alpha", true], ["bravo", true], ["charlie", true], ["delta", false]]);
  });

  it("moves the account's whole stake between candidates' votes, and out of them when cleared", async () => {
    const { reads, controls } = node();
    const before = await reads.candidates();
    const [alpha, bravo] = before?.candidates ?? [];
    if (alpha === undefined || bravo === undefined) throw new Error("the mock lists its candidates");
    controls.delegate(ME, alpha.address);
    expect((await reads.candidates())?.candidates[0]?.votes).toBe(alpha.votes + 500_000n * MONKEY_UNIT);
    expect(controls.stakingPosition(ME).delegate).toBe(alpha.address);
    controls.delegate(ME, bravo.address);
    const moved = (await reads.candidates())?.candidates;
    expect([moved?.[0]?.votes, moved?.[1]?.votes]).toEqual([alpha.votes, bravo.votes + 500_000n * MONKEY_UNIT]);
    controls.delegate(ME, NO_CANDIDATE);
    expect((await reads.candidates())?.candidates[1]?.votes).toBe(bravo.votes);
    expect(controls.stakingPosition(ME).delegate).toBeNull();
  });

  it("counts a delegator's votes as they follow its stake", async () => {
    const { reads, controls, state } = node();
    const alpha = (await reads.candidates())?.candidates[0];
    if (alpha === undefined) throw new Error("the mock lists its candidates");
    controls.delegate(ME, alpha.address);
    stake(state, ME, 100n * MONKEY_UNIT);
    expect((await reads.candidates())?.candidates[0]?.votes).toBe(alpha.votes + 500_100n * MONKEY_UNIT);
  });

  it("refuses a candidate it does not list", () => {
    expect(() => node().controls.delegate(ME, "0x00000000000000000000000000000000000000ff")).toThrow("lists no such candidate");
  });

  it("forgets a reset account's choice", () => {
    const { controls, state } = node();
    const first = state.operators.candidates[0];
    if (first === undefined) throw new Error("the mock lists its candidates");
    controls.delegate(ME, first.address);
    controls.resetAccount(ME);
    expect(state.operators.delegates.has(ME)).toBe(false);
  });

  it("takes the election into effect when the clock reaches its time, and the node's route follows", async () => {
    const { reads, state, client } = node();
    const pending = (await reads.operator())?.pending;
    if (!pending) throw new Error("the mock waits on an election");
    expect(await client.stats.operator()).toMatchObject({ rotation_enabled: true, pending_rotation: { address: pending.adminKey, effective_at: pending.effectiveAtMs }, last_election: { candidate: pending.candidate } });
    state.now = pending.effectiveAtMs;
    const named = await reads.operator();
    expect(named).toMatchObject({ candidate: pending.candidate, adminKey: pending.adminKey, sinceMs: pending.effectiveAtMs, hostname: "bravo.operators.example", pending: null });
    expect(await client.stats.operator()).toEqual({ operator: pending.adminKey, pending_rotation: null, rotation_enabled: true, last_election: null });
  });
});
