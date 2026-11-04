/** Tests for the simulated registry: what the mock build's Staking page shows of candidates and an election. */

import { describe, expect, it } from "vitest";

import { CANDIDATE_LIMIT, NO_CANDIDATE } from "../engine/registry";
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
    const alpha = table?.candidates[0];
    expect(table?.inEffect).toEqual({ candidate: named?.candidate, hostname: "alpha.operators.example", release: alpha?.release, registered: { bond: 50_000n * MONKEY_UNIT, release: alpha?.release, registration: 0, handoverEndpoint: "https://alpha.operators.example:9443/handover" } });
    expect(table?.candidates.find((c) => c.address === named?.pending?.candidate)?.hostname).toBe("bravo.operators.example");
  });

  it("lists as many candidates as the registry holds, eligible and not against the total stake, with every vote inside it", async () => {
    const table = await node().reads.candidates();
    const candidates = table?.candidates ?? [];
    expect(candidates).toHaveLength(CANDIDATE_LIMIT);
    expect(candidates.slice(0, 4).map((c) => [c.hostname.split(".")[0], c.eligible])).toEqual([["alpha", true], ["bravo", true], ["charlie", true], ["delta", false]]);
    expect(candidates.slice(4).every((c) => !c.eligible && /^node-\d{3}\.operators\.example$/.test(c.hostname))).toBe(true);
    expect(new Set(candidates.map((c) => c.address)).size).toBe(CANDIDATE_LIMIT);
    expect(candidates.map((c) => c.registration)).toEqual(candidates.map((_, i) => i));
    expect(candidates.reduce((sum, c) => sum + c.votes, 0n)).toBeLessThanOrEqual(table?.totalStaked ?? 0n);
  });

  it("moves the account's whole stake between candidates' votes, and out of them when cleared", async () => {
    const { reads, controls } = node();
    const before = await reads.candidates();
    const [alpha, bravo] = before?.candidates ?? [];
    if (alpha === undefined || bravo === undefined) throw new Error("the mock lists its candidates");
    controls.delegate(ME, alpha.address);
    expect((await reads.candidates())?.candidates[0]?.votes).toBe(alpha.votes + 500_000n * MONKEY_UNIT);
    await expect(reads.delegateOf(ME)).resolves.toBe(alpha.address);
    controls.delegate(ME, bravo.address);
    const moved = (await reads.candidates())?.candidates;
    expect([moved?.[0]?.votes, moved?.[1]?.votes]).toEqual([alpha.votes, bravo.votes + 500_000n * MONKEY_UNIT]);
    controls.delegate(ME, NO_CANDIDATE);
    expect((await reads.candidates())?.candidates[1]?.votes).toBe(bravo.votes);
    await expect(reads.delegateOf(ME)).resolves.toBeNull();
  });

  it("takes stake out of the total and the votes when its unstake starts, as the contract does, though the engine counts it through the cooldown", async () => {
    const { reads, controls, state } = node();
    const alpha = (await reads.candidates())?.candidates[0];
    const total = (await reads.candidates())?.totalStaked ?? 0n;
    if (alpha === undefined) throw new Error("the mock lists its candidates");
    controls.delegate(ME, alpha.address);
    controls.startUnstake(ME, 100n * MONKEY_UNIT);
    const after = await reads.candidates();
    expect(after?.totalStaked).toBe(total - 100n * MONKEY_UNIT);
    expect(after?.candidates[0]?.votes).toBe(alpha.votes + 499_900n * MONKEY_UNIT);
    expect(state.monkey.totalStakedAt(state.now)).toBeGreaterThan(after?.totalStaked ?? 0n);
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
