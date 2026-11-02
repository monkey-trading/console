/** Tests for the mock node's MONKEY mirror: accrual from gross realised losses less write-offs, the entitlement proof against the mock vault's checkpoint, and the simulated vault's claim. */

import { describe, expect, it } from "vitest";

import { periodOf } from "../engine/emission-schedule";
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

/** The account's fills' realised results, from the log: their sum, and the magnitude of the losses alone. */
function realisedOf(node: MockNode, account: string) {
  const results = node.client.state.log.flatMap((m) => m.events.flatMap((e) => (e.type === "fill" && e.account.toLowerCase() === account.toLowerCase() ? [fixedFromWire(e.realised_pnl)] : [])));
  return { net: results.reduce((sum, r) => sum + r, 0n), losses: results.reduce((sum, r) => (r < 0n ? sum - r : sum), 0n), wins: results.reduce((sum, r) => (r > 0n ? sum + r : sum), 0n) };
}

const proofOf = async (node: MockNode, account: string): Promise<EntitlementProof> => {
  const proof = await node.client.emissions(account);
  if (proof === null) throw new Error("expected an entitlement proof");
  return proof;
};

const allocations = (node: MockNode) => node.client.state.log.flatMap((m) => m.events.filter((e) => e.type === "emission_allocated" || e.type === "emission_period_closed"));

describe("MONKEY emissions", () => {
  it("serves the schedule its allocations follow: the open period, and the period a stamp falls in", async () => {
    const node = createMockNode(START);
    const open = await node.client.emissionSchedule();
    expect(open).toEqual({ startMs: 0, periodMs: EMISSION_PERIOD_MS, period: Math.floor(START / EMISSION_PERIOD_MS) });
    recordEmissionResult(node.client.state, ME, fixedFromInt(-1_000), 0n);
    node.client.tick(past(node.client.state.now));
    const allocation = allocations(node).find((e) => e.type === "emission_allocated");
    if (allocation?.type !== "emission_allocated" || open === null) throw new Error("expected an allocation and a schedule");
    expect(allocation.period).toBe(open.period);
    expect(periodOf(open, START)).toBe(allocation.period);
    expect((await node.client.emissionSchedule())?.period).toBe(allocation.period + 1);
  });

  it("serves no proof for an account with no allocation, as the node's 404", async () => {
    const node = await funded(10_000);
    expect(await node.client.emissions(ME)).toBeNull();
  });

  it("weights a period by gross realised losses less write-offs, whatever wins it holds", () => {
    const node = createMockNode(START);
    const state = node.client.state;
    // A loss with part written off: weight is the loss minus the write-off.
    recordEmissionResult(state, ME, fixedFromInt(-1_000), fixedFromInt(400));
    node.client.tick(past(state.now));
    expect(state.entitledMonkey.get(ME)).toBe(EMISSION_PERIOD_BUDGET);
    const allocated = allocations(node).find((e) => e.type === "emission_allocated");
    expect(allocated).toMatchObject({ account: ME, weight: fixedToWire(fixedFromInt(600)) });
    // A profit larger than the loss, in the same period, takes nothing from its weight (engine#442).
    const other = createMockNode(START);
    const oState = other.client.state;
    recordEmissionResult(oState, ME, fixedFromInt(-1_000), 0n);
    recordEmissionResult(oState, ME, fixedFromInt(1_200), 0n);
    other.client.tick(past(oState.now));
    expect(oState.entitledMonkey.get(ME)).toBe(EMISSION_PERIOD_BUDGET);
    expect(allocations(other).find((e) => e.type === "emission_allocated")).toMatchObject({ account: ME, weight: fixedToWire(fixedFromInt(1_000)) });
  });

  it("counts a losing fill in a period the account ends up in profit", async () => {
    const node = await funded(10_000);
    await roundTrip(node, ME, "0.05", -300, 10);
    await roundTrip(node, ME, "0.2", 600, 20);
    const { net, losses, wins } = realisedOf(node, ME);
    expect(net).toBeGreaterThan(0n);
    expect(losses).toBeGreaterThan(0n);
    expect(wins).toBeGreaterThan(losses);
    node.client.tick(past(node.client.state.now));
    const allocated = allocations(node).find((e) => e.type === "emission_allocated");
    expect(allocated).toMatchObject({ account: ME, weight: fixedToWire(losses), amount: EMISSION_PERIOD_BUDGET.toString() });
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

  it("judges weight before the tick's own effects: a 22:00 financing charge into negative cash does not forfeit it", () => {
    // 21:59:30 UTC, half a minute before 22:00 — which is also a ten-minute emission boundary.
    const late = Date.UTC(2026, 9, 28, 21, 59, 30);
    const node = createMockNode(late);
    const state = node.client.state;
    const account = state.account(ME);
    account.balance = 15_000_000n; // $0.015: positive cash at the cutoff, less than the tick's financing charge
    const mid = state.markets.get(1)?.mid ?? fixedFromInt(100_000);
    account.positions.set(1, { qty: fixedFromInt(1) / 100n, entry: mid }); // 0.01 BTC: ≈$674 at the mock's starting index, a ≈$0.135 charge
    recordEmissionResult(state, ME, fixedFromInt(-1_000), 0n);
    node.client.tick(late + 60_000); // crosses 22:00 and the period boundary in one tick
    const events = state.log.flatMap((m) => m.events.map((e) => e.type));
    // The period closed before the financing charge in the tick's own events, and the charge then
    // pushed the account's cash below zero (the close-out wrote it off) — the weight judged at the
    // cutoff still earns.
    expect(events.indexOf("emission_allocated")).toBeLessThan(events.indexOf("financing"));
    expect(events).toContain("bad_debt");
    expect(state.entitledMonkey.get(ME)).toBe(EMISSION_PERIOD_BUDGET);
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

  it("shares the budget in exact proportion to the gross losses and cancels the truncation dust", async () => {
    const node = createMockNode(START);
    const OTHER = "0xdef0000000000000000000000000000000000002";
    await losingAccount(node, ME, 10_000, "0.04");
    await losingAccount(node, OTHER, 10_000, "0.02");
    const meNet = -realisedOf(node, ME).losses;
    const otherNet = -realisedOf(node, OTHER).losses;
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
