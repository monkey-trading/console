/** Builds the mock node, its controls, and its wallet for one session. */

import { fixedToWire } from "../fixed";
import { MockEngineClient } from "./client";
import { MockControls, SEEDED_QUEUE } from "./controls";
import { DEMO_SPAN_MS, seedDemoAccount } from "./demo";
import { MockState } from "./state";
import { MockWalletConnector } from "./wallet";

export interface MockNode {
  client: MockEngineClient;
  controls: MockControls;
  wallets: MockWalletConnector;
}

/** The instant the first server render uses, so the browser's first render matches it. */
export const SIM_EPOCH_MS = Date.UTC(2026, 9, 28, 15, 0, 0);

/**
 * A mock node whose clock reads `startMs`, with other accounts already waiting to withdraw. With
 * `demo`, the demo account has a backstory played through the node's rules (see `seedDemoAccount`).
 */
export function createMockNode(startMs: number, demo = false): MockNode {
  const state = new MockState(demo ? startMs - DEMO_SPAN_MS : startMs);
  for (const entry of SEEDED_QUEUE) {
    state.account(entry.account);
    state.queue.push({ account: entry.account, amount: entry.amount, remaining: entry.amount, requestedSeq: state.seq + 1 });
    state.emit({ type: "withdraw" }, [{ type: "withdrawal_queued", account: entry.account, amount: fixedToWire(entry.amount), requested_seq: state.seq + 1 }]);
  }
  if (demo) seedDemoAccount(state, startMs);
  const client = new MockEngineClient(state);
  const controls = new MockControls(client);
  return { client, controls, wallets: new MockWalletConnector(controls) };
}
