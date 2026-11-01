/** Tests for the mock node's MONKEY mirror: accrual from net realised losses less write-offs, the entitlement proof against the mock vault's checkpoint, and the simulated vault's claim. */

import { describe, expect, it } from "vitest";

import type { EntitlementProof } from "../engine/emissions";
import type { OrderRequest } from "../engine/types";
import { fixedFromInt, fixedFromWire, fixedToWire } from "../fixed";
import { DEMO_ADDRESS } from "./demo";
import { EMISSION_PERIOD_BUDGET, EMISSION_PERIOD_MS, recordEmissionResult } from "./emissions";
import { createMockNode, type MockNode } from "./index";
import { funded, ME, START, types } from "./test-helpers";

/** The first instant after the emission period `ms` falls in. */
const past = (ms: number) => (Math.floor(ms / EMISSION_PERIOD_MS) + 1) * EMISSION_PERIOD_MS + 1;

/** A fresh request auth for `account`, as `test-helpers` builds for `ME`. */
function authOf(node: MockNode, account: string) {
  return { nonce: node.client.state.account(account).nextNonce, expires_at: node.client.state.now + 60_000, signature: `0x${"cd".repeat(65)}` };
}

/** Opens and closes a position for `account`: buy, move the index by `shockBps`, sell at the result. */
async function roundTrip(node: MockNode, account: string, qty: string, shockBps: number, clientId: number) {
  const mark = async () => (await node.client.markets()).find((m) => m.id === 1)?.mark ?? "0";
  const trade = async (side: "buy" | "sell", id: number): Promise<OrderRequest> => ({
    account, client_id: id, market: 1, side, qty, kind: { kind: "market", quoted: await mark(), max_slippage_bps: 50 }, auth: authOf(node, account),
  });
  await node.client.placeOrder(await trade("buy", clientId));
  node.controls.shock(1, shockBps);
  node.client.tick(node.client.state.now + 5_000);
  await node.client.placeOrder(await trade("sell", clientId + 1));
}

/** Attests and funds `account`, then gives it the period's only losing round trip. */
async function losingAccount(node: MockNode, account: string, dollars: number, qty: string) {
  await node.client.attestEligibility({ account, class: "professional", auth: authOf(node, account) });
  node.controls.deposit(account, fixedFromInt(dollars));
  node.client.tick(node.client.state.now + 7_000);
  await roundTrip(node, account, qty, -300, 1);
}

/** The account's net realised result recorded against the open period, from its fills' events. */
function netOf(node: MockNode, account: string) {
  const fills = node.client.state.log.flatMap((m) => m.events.filter((e) => e.type === "fill" && e.account.toLowerCase() === account.toLowerCase()));
  return fills.reduce((sum, e) => (e.type === "fill" ? sum + fixedFromWire(e.realised_pnl) : sum), 0n);
}

const proofOf = async (node: MockNode, account: string): Promise<EntitlementProof> => {
  const proof = await node.client.emissions(account);
  if (proof === null) throw new Error("expected an entitlement proof");
  return proof;
};

const allocations = (node: MockNode) => node.client.state.log.flatMap((m) => m.events.filter((e) => e.type === "emission_allocated" || e.type === "emission_period_closed"));

describe("MONKEY emissions", () => {
  it("serves no proof for an account with no allocation, as the node's 404", async () => {
    const node = await funded(10_000);
    expect(await node.client.emissions(ME)).toBeNull();
  });

  it("weights a period by net realised loss less write-offs, not by losing fills alone", () => {
    const node = createMockNode(START);
    const state = node.client.state;
    // A loss with part written off: weight is the loss minus the write-off.
    recordEmissionResult(state, ME, fixedFromInt(-1_000), fixedFromInt(400));
    node.client.tick(past(state.now));
    expect(state.entitledMonkey.get(ME)).toBe(EMISSION_PERIOD_BUDGET);
    const allocated = allocations(node).find((e) => e.type === "emission_allocated");
    expect(allocated).toMatchObject({ account: ME, weight: fixedToWire(fixedFromInt(600)) });
    // A loss fully offset by a profit in the same period earns nothing, and the budget is cancelled.
    const other = createMockNode(START);
    const oState = other.client.state;
    recordEmissionResult(oState, ME, fixedFromInt(-1_000), 0n);
    recordEmissionResult(oState, ME, fixedFromInt(1_200), 0n);
    other.client.tick(past(oState.now));
    expect(oState.entitledMonkey.get(ME)).toBeUndefined();
    expect(allocations(other).some((e) => e.type === "emission_allocated")).toBe(false);
    expect(allocations(other).find((e) => e.type === "emission_period_closed")).toMatchObject({ allocated: "0", cancelled: EMISSION_PERIOD_BUDGET.toString() });
  });

  it("forfeits the weight of an account with negative cash at the period's close", () => {
    const node = createMockNode(START);
    const state = node.client.state;
    recordEmissionResult(state, ME, fixedFromInt(-1_000), 0n);
    state.account(ME).balance = -1n; // cash below zero at the close
    node.client.tick(past(state.now));
    expect(state.entitledMonkey.get(ME)).toBeUndefined();
    expect(allocations(node).some((e) => e.type === "emission_allocated")).toBe(false);
  });

  it("allocates the whole period budget to the account with the period's only loss", async () => {
    const node = await funded(10_000);
    await roundTrip(node, ME, "0.05", -300, 10);
    node.client.tick(past(node.client.state.now));
    expect(node.client.state.entitledMonkey.get(ME)).toBe(EMISSION_PERIOD_BUDGET);
    const proof = await proofOf(node, ME);
    expect(proof).toMatchObject({ account: ME, entitled: EMISSION_PERIOD_BUDGET.toString() });
    expect(proof.seq).toBe(node.client.state.postedSeq);
  });

  it("shares the budget in exact proportion to the net losses and cancels the truncation dust", async () => {
    const node = createMockNode(START);
    const OTHER = "0xdef0000000000000000000000000000000000002";
    await losingAccount(node, ME, 10_000, "0.04");
    await losingAccount(node, OTHER, 10_000, "0.02");
    const meNet = netOf(node, ME);
    const otherNet = netOf(node, OTHER);
    expect(meNet).toBeLessThan(0n);
    expect(otherNet).toBeLessThan(0n);
    node.client.tick(past(node.client.state.now));
    const allocated = allocations(node).filter((e) => e.type === "emission_allocated");
    expect(allocated).toHaveLength(2);
    const closed = allocations(node).find((e) => e.type === "emission_period_closed");
    if (closed?.type !== "emission_period_closed") throw new Error("expected a period close");
    // The engine's exact rule: amount = budget * weight / total weight, truncated; the remainder is cancelled.
    const meWeight = -meNet;
    const total = meWeight + -otherNet;
    const expectedMe = (EMISSION_PERIOD_BUDGET * meWeight) / total;
    const expectedOther = (EMISSION_PERIOD_BUDGET * -otherNet) / total;
    const me = allocated.find((e) => e.type === "emission_allocated" && e.account === ME);
    const other = allocated.find((e) => e.type === "emission_allocated" && e.account === OTHER);
    if (me?.type !== "emission_allocated" || other?.type !== "emission_allocated") throw new Error("expected both allocations");
    expect(BigInt(me.amount)).toBe(expectedMe);
    expect(BigInt(other.amount)).toBe(expectedOther);
    expect(me.weight).toBe(fixedToWire(meWeight));
    // 18-decimal division leaves dust: the allocations do not reach the budget exactly.
    expect(expectedMe + expectedOther).toBeLessThan(EMISSION_PERIOD_BUDGET);
    expect(BigInt(closed.cancelled)).toBe(EMISSION_PERIOD_BUDGET - expectedMe - expectedOther);
    expect(BigInt(closed.allocated)).toBe(expectedMe + expectedOther);
  });

  it("cancels the whole budget of a period with no losses", async () => {
    const node = await funded(10_000);
    node.client.tick(past(node.client.state.now));
    const closed = allocations(node).find((e) => e.type === "emission_period_closed");
    expect(closed).toMatchObject({ allocated: "0" });
    if (closed?.type !== "emission_period_closed") throw new Error("expected a period close");
    expect(closed.cancelled).toBe(EMISSION_PERIOD_BUDGET.toString());
  });

  it("lets the wallet claim what the proof proves, settles the vault's record, and refuses a claim with nothing new", async () => {
    const node = createMockNode(START);
    const wallet = await node.wallets.connect("browser");
    await losingAccount(node, wallet.address, 10_000, "0.05");
    node.client.tick(past(node.client.state.now));
    const proof = await proofOf(node, wallet.address);
    expect(proof.entitled).toBe(EMISSION_PERIOD_BUDGET.toString());
    expect(proof.seq).toBe(node.client.state.postedSeq);
    expect(await wallet.emissionsClaimed?.()).toEqual({ claimed: 0n, latestSeq: node.client.state.postedSeq });
    await wallet.claimEmissions?.(proof);
    expect(await wallet.emissionsClaimed?.()).toEqual({ claimed: EMISSION_PERIOD_BUDGET, latestSeq: node.client.state.postedSeq });
    await expect(wallet.claimEmissions?.(proof)).rejects.toThrow("already minted");
  });

  it("drops an account's pending period weight when the account is reset", async () => {
    const node = createMockNode(START);
    await losingAccount(node, ME, 10_000, "0.05");
    node.controls.resetAccount(ME);
    node.client.tick(past(node.client.state.now));
    expect(node.client.state.entitledMonkey.get(ME)).toBeUndefined();
    expect(allocations(node).some((e) => e.type === "emission_allocated")).toBe(false);
  });

  it("accrues entitlement for the demo account's backstory losses", () => {
    const node = createMockNode(START, true);
    expect(node.client.state.entitledMonkey.get(DEMO_ADDRESS) ?? 0n).toBeGreaterThan(0n);
    expect(types(node.client.state.log.flatMap((m) => m.events))).toContain("emission_allocated");
  });
});
