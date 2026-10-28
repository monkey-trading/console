/** Shared setup for the mock node's tests: a funded, attested account and signed requests. */

import type { EngineEvent, OrderRequest } from "../engine/types";
import { fixedFromInt } from "../fixed";
import { SEEDED_QUEUE } from "./controls";
import { createMockNode, type MockNode } from "./index";

export const ME = "0xabc0000000000000000000000000000000000001";
// A Wednesday at 15:00 UTC, when every market is open.
export const START = Date.UTC(2026, 9, 28, 15, 0, 0);
const SIG = `0x${"ab".repeat(65)}`;

export function auth(node: MockNode) {
  const next = node.client.state.account(ME).nextNonce;
  return { nonce: next, expires_at: node.client.state.now + 60_000, signature: SIG };
}

/**
 * Puts the vault back as the node starts it: no liquidity, and the other accounts' requests waiting.
 * A finalized deposit adds liquidity that pays the queue, which a test of the queue does not want.
 */
export function resetVault(node: MockNode): void {
  const { state } = node.client;
  state.vaultLiquidity = 0n;
  state.queue.splice(0);
  for (const entry of SEEDED_QUEUE) state.queue.push({ account: entry.account, amount: entry.amount, remaining: entry.amount, requestedSeq: 1 });
}

/** A node with `ME` attested and funded with `dollars`, after finality. */
export async function funded(dollars: number): Promise<MockNode> {
  const node = createMockNode(START);
  await node.client.attestEligibility({ account: ME, class: "professional", auth: auth(node) });
  node.controls.deposit(ME, fixedFromInt(dollars));
  node.client.tick(START + 1_000);
  node.client.tick(START + 7_000);
  resetVault(node);
  return node;
}

export async function order(node: MockNode, qty: string, side: "buy" | "sell", extra: Partial<OrderRequest> = {}, market = 1) {
  const mark = (await node.client.markets()).find((m) => m.id === market)?.mark ?? "0";
  return node.client.placeOrder({
    account: ME, client_id: 1, market, side, qty,
    kind: { kind: "market", quoted: mark, max_slippage_bps: 50 }, auth: auth(node), ...extra,
  });
}

export const types = (events: EngineEvent[]) => events.map((e) => e.type);
