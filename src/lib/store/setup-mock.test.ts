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
import { setupFacts, setupStepDone, setupVisible } from "./setup";
import { ConsoleStore } from "./store";

/** A store over the mock, started and past its access check, with the demo's backstory when `demo`. */
async function setup(demo: boolean) {
  const node = createMockNode(SIM_EPOCH_MS, demo);
  const store = new ConsoleStore({ client: node.client, wallets: node.wallets, drive: (ms) => node.client.tick(ms), history: mockHistory, initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS } });
  store.start(SIM_EPOCH_MS);
  await settle();
  return { node, store };
}

const steps = (store: ConsoleStore) => setupSteps(setupFacts(store.getSnapshot(), false));

describe("setup on the mock", () => {
  it("connects the demo account on load holding a key, with no popup, as a returning trader", async () => {
    const { store } = await setup(true);
    await connectWallet(store, "browser", true);
    expect(store.getSnapshot().wallet?.address).toBe(DEMO_ADDRESS);
    expect(liveSessionKey(store)).not.toBeNull();
    expect(store.getSnapshot().setup).toMatchObject({ open: false, decided: true });
  });

  it("brings the popup back at the key's step when the demo account disconnects and connects again", async () => {
    const { node, store } = await setup(true);
    await connectWallet(store, "browser", true);
    const key = liveSessionKey(store)?.address.toLowerCase();
    if (key === undefined) throw new Error("the demo account holds no key");
    expect(node.client.state.sessionKeys.get(DEMO_ADDRESS.toLowerCase())?.has(key)).toBe(true);
    disconnectWallet(store);
    await settle();
    expect(store.walletCleanup).not.toBeNull();
    await connectWallet(store, "browser");
    expect(setupVisible(store.getSnapshot())).toBe(true);
    expect(steps(store)).toEqual(["authorize"]);
  });

  it("takes a fresh account through declare, authorize and Funding, then a deposit and a silent trade", async () => {
    const { store } = await setup(false);
    await connectWallet(store, "walletconnect");
    expect(setupVisible(store.getSnapshot())).toBe(true);
    expect(steps(store)).toEqual(["declare", "authorize"]);
    await attestEligibility(store, "professional");
    expect(steps(store)).toEqual(["authorize"]);
    expect(await authorizeBrowser(store)).toBe(true);
    expect(store.getSnapshot().account).toBeNull(); // declared and keyed with nothing deposited
    expect(setupStepDone(store, false)).toBe("funding");
    await deposit(store, fixedFromInt(10_000));
    expect(store.getSnapshot().account?.balance).toBe(fixedFromInt(10_000));
    const market = store.getSnapshot().markets.find((m) => m.mark !== null);
    if (!market?.mark) throw new Error("no priced market");
    const wallet = store.liveWallet;
    if (wallet === null) throw new Error("no wallet");
    wallet.sign = async () => { throw new Error("the wallet must not be asked"); };
    expect(await placeOrder(store, { market: market.id, side: "buy", qty: fixedFromWire("0.01"), kind: { kind: "market", quoted: market.mark, slippageBps: 500 }, reduceOnly: false })).toBe(true);
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
    expect(steps(store)).toEqual(["declare", "authorize"]);
  });
});
