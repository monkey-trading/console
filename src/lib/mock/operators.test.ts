/** Tests for the simulated registry: what the mock build's Staking page shows of candidates and an election. */

import { describe, expect, it } from "vitest";

import { CANDIDATE_LIMIT } from "../engine/staking-reads";
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
    const list = await node().client.stats.operators();
    const alpha = list.candidates[0];
    expect(list.operator_in_effect).toMatchObject({ candidate: named?.candidate, release: alpha?.release });
    expect(list.pending_election).toMatchObject({ candidate: named?.pending?.candidate, effective_at_ms: named?.pending?.effectiveAtMs, promoted: false });
    expect(list.candidates.find((c) => c.address === named?.pending?.candidate)?.api_hostname).toBe("bravo.operators.example");
  });

  it("lists as many candidates as the registry holds, eligible and not against the total stake, with every vote inside it, at a block", async () => {
    const list = await node().client.stats.operators();
    const { candidates } = list;
    expect(candidates).toHaveLength(CANDIDATE_LIMIT);
    expect(candidates.slice(0, 4).map((c) => [c.api_hostname.split(".")[0], c.eligible, c.role])).toEqual([["alpha", true, "operator"], ["bravo", true, "elected"], ["charlie", true, "candidate"], ["delta", false, "candidate"]]);
    expect(candidates.slice(4).every((c) => !c.eligible && /^node-\d{3}\.operators\.example$/.test(c.api_hostname))).toBe(true);
    expect(new Set(candidates.map((c) => c.address)).size).toBe(CANDIDATE_LIMIT);
    expect(candidates.map((c) => c.registration)).toEqual(candidates.map((_, i) => i));
    expect(candidates.reduce((sum, c) => sum + BigInt(c.votes), 0n)).toBeLessThanOrEqual(BigInt(list.total_staked));
    expect(list.block.number).toBeGreaterThan(0);
  });

  it("delegates amounts of the account's stake, moves and takes them back, as `Staking` keeps them and the votes follow", async () => {
    const { client, controls } = node();
    const votes = async (n: number) => BigInt((await client.stats.operators()).candidates[n]?.votes ?? "0");
    const [alpha, bravo] = client.state.operators.candidates;
    if (alpha === undefined || bravo === undefined) throw new Error("the mock lists its candidates");
    const [a, b] = [await votes(0), await votes(1)];
    controls.moveDelegation(ME, null, alpha.address, 300n * MONKEY_UNIT);
    controls.moveDelegation(ME, null, bravo.address, 200n * MONKEY_UNIT);
    controls.moveDelegation(ME, alpha.address, bravo.address, 100n * MONKEY_UNIT);
    controls.moveDelegation(ME, bravo.address, null, 100n * MONKEY_UNIT);
    expect([await votes(0), await votes(1)]).toEqual([a + 200n * MONKEY_UNIT, b + 200n * MONKEY_UNIT]);
    expect(controls.stakeDelegations(ME).delegations).toEqual([{ candidate: alpha.address, amount: 200n * MONKEY_UNIT }, { candidate: bravo.address, amount: 200n * MONKEY_UNIT }]);
  });

  it("takes an unstake from the undelegated stake first, then from the delegations in proportion, and out of the total at once", async () => {
    const { client, controls, state } = node();
    const [alpha, bravo] = state.operators.candidates;
    if (alpha === undefined || bravo === undefined) throw new Error("the mock lists its candidates");
    controls.moveDelegation(ME, null, alpha.address, 300_000n * MONKEY_UNIT);
    controls.moveDelegation(ME, null, bravo.address, 100_000n * MONKEY_UNIT);
    const total = BigInt((await client.stats.operators()).total_staked);
    // 100,000 undelegated, then 50,000 from 400,000 delegated: a quarter from bravo, the rest from alpha.
    controls.startUnstake(ME, 150_000n * MONKEY_UNIT);
    expect(controls.stakeDelegations(ME).delegations).toEqual([{ candidate: alpha.address, amount: 262_500n * MONKEY_UNIT }, { candidate: bravo.address, amount: 87_500n * MONKEY_UNIT }]);
    expect(BigInt((await client.stats.operators()).total_staked)).toBe(total - 150_000n * MONKEY_UNIT);
    expect(state.monkey.totalStakedAt(state.now)).toBeGreaterThan(total - 150_000n * MONKEY_UNIT);
  });

  it("refuses an amount over the undelegated stake or a delegation, a zero amount, the zero address, and a move to the same one, and takes any other address as the contract does", () => {
    const { controls, state } = node();
    const alpha = state.operators.candidates[0]?.address ?? "";
    expect(() => controls.moveDelegation(ME, null, alpha, 500_001n * MONKEY_UNIT)).toThrow("undelegated stake is less");
    expect(() => controls.moveDelegation(ME, alpha, null, 1n)).toThrow("delegation there is less");
    expect(() => controls.moveDelegation(ME, null, alpha, 0n)).toThrow("more than zero");
    expect(() => controls.moveDelegation(ME, null, "0x0000000000000000000000000000000000000000", 1n)).toThrow("not the zero address");
    controls.moveDelegation(ME, null, "0x00000000000000000000000000000000000000ff", 1n);
    expect(controls.stakeDelegations(ME)).toMatchObject({ delegated: 1n, delegations: [{ candidate: "0x00000000000000000000000000000000000000ff", amount: 1n }] });
    controls.moveDelegation(ME, "0x00000000000000000000000000000000000000ff", null, 1n);
    controls.moveDelegation(ME, null, alpha, 5n);
    expect(() => controls.moveDelegation(ME, alpha, alpha, 1n)).toThrow("another candidate");
  });

  it("forgets a reset account's delegations", () => {
    const { controls, state } = node();
    const first = state.operators.candidates[0];
    if (first === undefined) throw new Error("the mock lists its candidates");
    controls.moveDelegation(ME, null, first.address, MONKEY_UNIT);
    controls.resetAccount(ME);
    expect(state.operators.delegations.has(ME)).toBe(false);
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
