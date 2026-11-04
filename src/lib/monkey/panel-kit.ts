/** Shared setup for the MONKEY and Staking pages' store's tests: the mock node, its wallet, and a started panel. */

import { vi } from "vitest";

import { createMockNode, SIM_EPOCH_MS } from "../mock";
import { DEMO_ADDRESS } from "../mock/demo";
import { mockHistory } from "../mock/history";
import { seedMonkeyDemo } from "../mock/monkey";
import { connectWallet } from "../store/actions";
import { ConsoleStore } from "../store/store";
import { MonkeyPanel } from "./panel";
import type { PanelPage } from "./panel-state";

/** The mock node and a store with the demo wallet connected, and a started panel for `page`: the Staking page's, unless a test reads the MONKEY page's. */
export async function setup(page: PanelPage = "staking") {
  const node = createMockNode(SIM_EPOCH_MS);
  seedMonkeyDemo(node.client.state, DEMO_ADDRESS);
  const store = new ConsoleStore({
    client: node.client, wallets: node.wallets, drive: (ms) => node.client.tick(ms), history: mockHistory,
    initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS },
  });
  store.start(SIM_EPOCH_MS);
  await connectWallet(store, "browser");
  const panel = new MonkeyPanel(store, page);
  const stop = panel.start(() => false);
  await panel.refreshWallet();
  return { node, store, panel, stop };
}

/** Lets every promise that can settle without a timer settle, however long the chain. */
export async function flush() {
  for (let i = 0; i < 8; i += 1) await vi.advanceTimersByTimeAsync(0);
}

/**
 * Holds the connected wallet's next page read until `release` is called (the stake on the Staking
 * page, the vault's MONKEY record on the MONKEY page), and counts the stakes it sends. The wallet's
 * other calls run as they would.
 */
export function holdReads(store: ConsoleStore) {
  const wallet = store.liveWallet;
  const staking = wallet?.staking;
  const record = wallet?.emissionsClaimed;
  if (wallet === null || staking === undefined || record === undefined) throw new Error("the mock wallet stakes and reads the vault");
  const held = { release: () => {}, stakes: 0 };
  let first = true;
  const hold = async () => {
    if (!first) return;
    first = false;
    await new Promise<void>((resolve) => { held.release = resolve; });
  };
  wallet.emissionsClaimed = async () => {
    await hold();
    return record();
  };
  wallet.staking = {
    ...staking,
    position: async () => {
      await hold();
      return staking.position();
    },
    stake: async (amount, progress) => {
      held.stakes += 1;
      return staking.stake(amount, progress);
    },
  };
  return held;
}
