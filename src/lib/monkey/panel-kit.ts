/** Shared setup for the MONKEY page store's tests: the mock node, its wallet, and a started panel. */

import { vi } from "vitest";

import { createMockNode, SIM_EPOCH_MS } from "../mock";
import { DEMO_ADDRESS } from "../mock/demo";
import { mockHistory } from "../mock/history";
import { seedMonkeyDemo } from "../mock/monkey";
import { connectWallet } from "../store/actions";
import { ConsoleStore } from "../store/store";
import { MonkeyPanel } from "./panel";

export async function setup() {
  const node = createMockNode(SIM_EPOCH_MS);
  seedMonkeyDemo(node.client.state, DEMO_ADDRESS);
  const store = new ConsoleStore({
    client: node.client, wallets: node.wallets, drive: (ms) => node.client.tick(ms), history: mockHistory,
    initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS },
  });
  store.start(SIM_EPOCH_MS);
  await connectWallet(store, "browser");
  const panel = new MonkeyPanel(store);
  const stop = panel.start(() => false);
  await panel.refreshWallet();
  return { node, store, panel, stop };
}

/** Lets every promise that can settle without a timer settle, however long the chain. */
export async function flush() {
  for (let i = 0; i < 8; i += 1) await vi.advanceTimersByTimeAsync(0);
}

/**
 * Holds the connected wallet's next chain read until `release` is called, and counts the stakes it
 * sends. The wallet's other calls run as they would.
 */
export function holdReads(store: ConsoleStore) {
  const wallet = store.liveWallet;
  const staking = wallet?.staking;
  if (wallet === null || staking === undefined) throw new Error("the mock wallet stakes");
  const held = { release: () => {}, stakes: 0 };
  let first = true;
  wallet.staking = {
    ...staking,
    position: async () => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => { held.release = resolve; });
      }
      return staking.position();
    },
    stake: async (amount, progress) => {
      held.stakes += 1;
      return staking.stake(amount, progress);
    },
  };
  return held;
}
