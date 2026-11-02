/** Tests for setup against the in-browser mock node, which mirrors the node's order: declare, register, deposit, trade. */

import { describe, expect, it } from "vitest";

import { settle } from "../engine/test-kit";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { createMockNode, SIM_EPOCH_MS } from "../mock";
import { DEMO_ADDRESS } from "../mock/demo";
import { mockHistory } from "../mock/history";
import { setupSteps } from "../setup-steps";
import { attestEligibility, authorizeBrowser, connectWallet, deposit, disconnectWallet, placeOrder } from "./actions";
import { liveSessionKey } from "./session";
import { setupFacts, setupVisible } from "./setup";
import { ConsoleStore } from "./store";

/** A store over the mock, started and past its access check, with the demo's backstory when `demo`. */
async function setup(demo: boolean) {
  const node = createMockNode(SIM_EPOCH_MS, demo);
  const store = new ConsoleStore({ client: node.client, wallets: node.wallets, drive: (ms) => node.client.tick(ms), history: mockHistory, initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS } });
  store.start(SIM_EPOCH_MS);
  await settle();
  return { node, store };
}

const steps = (store: ConsoleStore) => setupSteps(setupFacts(store.getSnapshot(), false)).filter((s) => !s.done).map((s) => s.step);

describe("setup on the mock", () => {
  it("connects the demo account on load holding a key, with no popup, as a returning trader", async () => {
    const { store } = await setup(true);
    await connectWallet(store, "browser", true);
    expect(store.getSnapshot().wallet?.address).toBe(DEMO_ADDRESS);
    expect(liveSessionKey(store)).not.toBeNull();
    expect(store.getSnapshot().setup).toMatchObject({ open: false, decided: true });
  });

  it("asks the demo account for its key straight away when it disconnects and connects again, with no popup", async () => {
    const { node, store } = await setup(true);
    await connectWallet(store, "browser", true);
    const key = liveSessionKey(store)?.address.toLowerCase();
    if (key === undefined) throw new Error("the demo account holds no key");
    expect(node.client.state.sessionKeys.get(DEMO_ADDRESS.toLowerCase())?.has(key)).toBe(true);
    disconnectWallet(store);
    await settle();
    expect(store.walletCleanup).not.toBeNull();
    await connectWallet(store, "browser");
    await settle();
    expect(setupVisible(store.getSnapshot())).toBe(false);
    expect(liveSessionKey(store)).not.toBeNull();
  });

  it("takes a fresh account through declare, authorize and the deposit inside the popup, with every step kept, then a silent trade", async () => {
    const { store } = await setup(false);
    await connectWallet(store, "walletconnect");
    expect(setupVisible(store.getSnapshot())).toBe(true);
    expect(steps(store)).toEqual(["declare", "authorize", "deposit"]);
    expect(store.getSnapshot().walletUsdc.read).toEqual({ status: "held", amount: fixedFromInt(50_000) });
    await attestEligibility(store, "professional");
    expect(steps(store)).toEqual(["authorize", "deposit"]);
    expect(await authorizeBrowser(store)).toBe(true);
    expect(store.getSnapshot().account).toBeNull(); // declared and keyed with nothing deposited
    expect(steps(store)).toEqual(["deposit"]);
    await deposit(store, fixedFromInt(10_000));
    expect(store.getSnapshot().account?.balance).toBe(fixedFromInt(10_000));
    expect(setupSteps(setupFacts(store.getSnapshot(), false)).map((s) => s.done)).toEqual([true, true, true]); // all three stay listed, done
    expect(store.getSnapshot().setup.deposit).toEqual({ amount: fixedFromInt(10_000), balanceBefore: 0n });
    expect(setupSteps(setupFacts(store.getSnapshot(), false)).at(-1)?.summary).toBe("10,000 USDC deposited");
    expect(setupVisible(store.getSnapshot())).toBe(true); // until the user presses Start trading
    expect(store.getSnapshot().walletUsdc.read).toEqual({ status: "held", amount: fixedFromInt(40_000) });
    const market = store.getSnapshot().markets.find((m) => m.mark !== null);
    if (!market?.mark) throw new Error("no priced market");
    const wallet = store.liveWallet;
    if (wallet === null) throw new Error("no wallet");
    wallet.sign = async () => { throw new Error("the wallet must not be asked"); };
    expect(await placeOrder(store, { market: market.id, side: "buy", qty: fixedFromWire("0.01"), kind: { kind: "market", quoted: market.mark, slippageBps: 500 }, reduceOnly: false })).toBe(true);
  });

  it("refuses a deposit above what the mock wallet holds, as the wallet's own balance check does", async () => {
    const { store } = await setup(false);
    await connectWallet(store, "walletconnect");
    await attestEligibility(store, "professional");
    await deposit(store, fixedFromInt(60_000));
    expect(store.getSnapshot().account).toBeNull();
    expect(store.getSnapshot().toasts.at(-1)?.text).toContain("holds less USDC");
  });

  it("says a never-credited account must declare first when it tries to register before declaring", async () => {
    const { store } = await setup(false);
    await connectWallet(store, "walletconnect");
    expect(await authorizeBrowser(store)).toBe(false);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("a never-credited account must declare first");
    expect(liveSessionKey(store)).toBeNull();
  });

  it("asks for setup again after the mock's reset: the key went with the account, so it is forgotten rather than tried", async () => {
    const { node, store } = await setup(true);
    await connectWallet(store, "browser", true);
    node.controls.resetAccount(DEMO_ADDRESS);
    await store.refresh(true);
    expect(liveSessionKey(store)).toBeNull();
    expect(store.getSnapshot().wallet?.address).toBe(DEMO_ADDRESS);
    expect(steps(store)).toEqual(["declare", "authorize", "deposit"]);
  });
});
