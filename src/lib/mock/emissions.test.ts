/** Tests for the mock node's MONKEY mirror: accrual from realised losses, the entitlement proof, and the simulated vault's claim. */

import { describe, expect, it } from "vitest";

import type { EntitlementProof } from "../engine/emissions";
import type { OrderRequest } from "../engine/types";
import { fixedFromInt } from "../fixed";
import { DEMO_ADDRESS } from "./demo";
import { EMISSION_PERIOD_BUDGET, EMISSION_PERIOD_MS } from "./emissions";
import { createMockNode, type MockNode } from "./index";
import { funded, ME, START, types } from "./test-helpers";

/** The first instant after the emission period `ms` falls in. */
const past = (ms: number) => (Math.floor(ms / EMISSION_PERIOD_MS) + 1) * EMISSION_PERIOD_MS + 1;

/** Opens and closes a losing position for `account`: buy, drop the index, sell at the loss. */
async function realiseLoss(node: MockNode, account: string, qty: string, clientId: number) {
  const mark = async () => (await node.client.markets()).find((m) => m.id === 1)?.mark ?? "0";
  const trade = async (side: "buy" | "sell", id: number): Promise<OrderRequest> => ({
    account, client_id: id, market: 1, side, qty, kind: { kind: "market", quoted: await mark(), max_slippage_bps: 50 }, auth: authOf(node, account),
  });
  await node.client.placeOrder(await trade("buy", clientId));
  node.controls.shock(1, -300);
  node.client.tick(node.client.state.now + 5_000);
  await node.client.placeOrder(await trade("sell", clientId + 1));
}

/** A fresh request auth for `account`, as `test-helpers` builds for `ME`. */
function authOf(node: MockNode, account: string) {
  return { nonce: node.client.state.account(account).nextNonce, expires_at: node.client.state.now + 60_000, signature: `0x${"cd".repeat(65)}` };
}

/** The account's entitlement proof; fails the test when the node serves none. */
async function proofOf(node: MockNode, account: string): Promise<EntitlementProof> {
  const proof = await node.client.emissions(account);
  if (proof === null) throw new Error("expected an entitlement proof");
  return proof;
}

/** Attests and funds `account`, then closes a losing position for it. */
async function losingAccount(node: MockNode, account: string, dollars: number, qty: string) {
  await node.client.attestEligibility({ account, class: "professional", auth: authOf(node, account) });
  node.controls.deposit(account, fixedFromInt(dollars));
  node.client.tick(node.client.state.now + 7_000);
  await realiseLoss(node, account, qty, 1);
}

const emissions = (node: MockNode) => node.client.state.log.flatMap((m) => m.events.filter((e) => e.type === "emission_allocated" || e.type === "emission_period_closed"));

describe("MONKEY emissions", () => {
  it("serves no proof for an account with no allocation, as the node's 404", async () => {
    const node = await funded(10_000);
    expect(await node.client.emissions(ME)).toBeNull();
  });

  it("allocates the whole period budget to the account with the period's only loss", async () => {
    const node = await funded(10_000);
    await realiseLoss(node, ME, "0.05", 10);
    node.client.tick(past(node.client.state.now));
    const allocated = emissions(node).filter((e) => e.type === "emission_allocated");
    expect(allocated).toHaveLength(1);
    expect(node.client.state.entitledMonkey.get(ME)).toBe(EMISSION_PERIOD_BUDGET);
    const proof = await proofOf(node, ME);
    expect(proof).toMatchObject({ account: ME, entitled: EMISSION_PERIOD_BUDGET.toString() });
    expect(proof.seq).toBe(node.client.headSeq);
  });

  it("shares the budget between two accounts in proportion to their losses and cancels the truncation dust", async () => {
    const node = createMockNode(START);
    const OTHER = "0xdef0000000000000000000000000000000000002";
    await losingAccount(node, ME, 10_000, "0.04");
    await losingAccount(node, OTHER, 10_000, "0.02");
    node.client.tick(past(node.client.state.now));
    const allocated = emissions(node).filter((e) => e.type === "emission_allocated");
    expect(allocated).toHaveLength(2);
    const closed = emissions(node).find((e) => e.type === "emission_period_closed");
    if (closed?.type !== "emission_period_closed") throw new Error("expected a period close");
    const total = allocated.reduce((sum, e) => (e.type === "emission_allocated" ? sum + BigInt(e.amount) : sum), 0n);
    expect(total).toBeGreaterThan(0n);
    expect(total + BigInt(closed.cancelled)).toBe(EMISSION_PERIOD_BUDGET);
    // The larger loss takes the larger share: 0.04 BTC against 0.02 BTC of the same index move.
    const amounts = new Map(allocated.flatMap((e) => (e.type === "emission_allocated" ? [[e.account.toLowerCase(), BigInt(e.amount)] as const] : [])));
    expect(amounts.get(ME) ?? 0n).toBeGreaterThan(amounts.get(OTHER) ?? 0n);
  });

  it("cancels the whole budget of a period with no losses", async () => {
    const node = await funded(10_000);
    node.client.tick(past(node.client.state.now));
    const closed = emissions(node).find((e) => e.type === "emission_period_closed");
    expect(closed).toMatchObject({ allocated: "0" });
    if (closed?.type !== "emission_period_closed") throw new Error("expected a period close");
    expect(closed.cancelled).toBe(EMISSION_PERIOD_BUDGET.toString());
    expect(emissions(node).some((e) => e.type === "emission_allocated")).toBe(false);
  });

  it("lets the wallet claim what the proof proves, settles the vault's record, and refuses a claim with nothing new", async () => {
    const node = createMockNode(START);
    const wallet = await node.wallets.connect("browser");
    await losingAccount(node, wallet.address, 10_000, "0.05");
    node.client.tick(past(node.client.state.now));
    const proof = await proofOf(node, wallet.address);
    expect(proof.entitled).toBe(EMISSION_PERIOD_BUDGET.toString());
    expect(await wallet.emissionsClaimed?.()).toEqual({ claimed: 0n, latestSeq: node.client.headSeq });
    await wallet.claimEmissions?.(proof);
    expect(await wallet.emissionsClaimed?.()).toEqual({ claimed: EMISSION_PERIOD_BUDGET, latestSeq: node.client.headSeq });
    await expect(wallet.claimEmissions?.(proof)).rejects.toThrow("already minted");
  });

  it("accrues entitlement for the demo account's backstory losses", () => {
    const node = createMockNode(START, true);
    expect(node.client.state.entitledMonkey.get(DEMO_ADDRESS) ?? 0n).toBeGreaterThan(0n);
    expect(types(node.client.state.log.flatMap((m) => m.events))).toContain("emission_allocated");
  });
});
