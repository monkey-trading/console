/** Tests for what a connect asks of the wallet (nothing), and for a connect replacing another wallet. */

import { describe, expect, it } from "vitest";

import vectors from "../engine/eip712-vectors.json";
import { ProviderWallet } from "../engine/provider-wallet";
import { ACCOUNT, StubProvider } from "../engine/wallet-kit";
import type { Wallet } from "../engine/wallet";
import { authorizeBrowser, connectWallet } from "./actions";
import { ActionClient, BTC, NODE_TIME, VAULT } from "./live-kit";
import { liveSessionKey } from "./session";
import { ConsoleStore } from "./store";
import { settle } from "../engine/test-kit";

/** A started store over an ActionClient that records what it is sent. */
async function setup(credited: boolean) {
  const client = new ActionClient();
  client.credited = credited;
  const provider = new StubProvider();
  const walletA: Wallet = new ProviderWallet(ACCOUNT, "Test wallet", provider, { chainId: vectors.chain_id, vault: VAULT, usdc: null, add: null }, { wait: async () => {} });
  const store = new ConsoleStore({ client, wallets: { options: [], connect: async () => walletA }, history: () => [], initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  store.start(0);
  await settle();
  return { client, provider, store, walletA };
}

const signatures = (provider: StubProvider) => provider.calls.filter((c) => c.method === "eth_signTypedData_v4");

describe("what a connect asks of the wallet", () => {
  it("asks for no signature and registers nothing at connect, credited or not", async () => {
    for (const credited of [true, false]) {
      const { client, provider, store } = await setup(credited);
      expect(await connectWallet(store, "injected")).toBe(true);
      expect(client.posted).toEqual([]);
      expect(signatures(provider)).toEqual([]);
      expect(liveSessionKey(store)).toBeNull();
    }
  });

  it("registers nothing when the account's credit arrives: a deposit, or a deposit credited on a screening retry", async () => {
    const { client, provider, store } = await setup(false);
    await connectWallet(store, "injected");
    client.credited = true;
    const receipt = { beneficiary: { kind: "trader", account: ACCOUNT }, principal: "1000", held: "0", uncredited: "0" };
    client.deliver({ offset: "1:0", type: "command", seq: 1, ts: NODE_TIME, cmd: { type: "deposit" }, events: [{ type: "deposited", account: ACCOUNT, amount: "1000" }] });
    // The receipt carries more than this path reads; the event's own fields stand in for it.
    client.deliver({ offset: "2:0", type: "command", seq: 2, ts: NODE_TIME, cmd: { type: "deposit" }, events: [{ type: "custody_deposit_changed", receipt } as never] });
    await settle();
    expect(client.posted).toEqual([]);
    expect(signatures(provider)).toEqual([]);
  });

  it("registers nothing when the feed turns live after a connect that found it starting", async () => {
    const { client, provider, store } = await setup(true);
    store.patch({ stream: "connecting" });
    await connectWallet(store, "injected");
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(client.posted).toEqual([]);
    expect(signatures(provider)).toEqual([]);
  });

  it("clears the session key and refusal when a connect replaces the wallet", async () => {
    const { store } = await setup(true);
    const walletB: Wallet = { address: "0x0000000000000000000000000000000000000bbb", label: "Other", sign: async () => "0x", deposit: async () => "0x0", claim: async () => "0x0" };
    await connectWallet(store, "injected");
    await authorizeBrowser(store);
    const keyOfA = liveSessionKey(store);
    if (keyOfA === null) throw new Error("no key for wallet A");
    store.patch({ sessionRefusal: { kind: "session_key_unsupported" } });
    store.deps.wallets.connect = async () => walletB;
    await connectWallet(store, "other");
    expect(liveSessionKey(store)).toBeNull();
    expect(store.sessionKey).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ sessionRefusal: null, sessionExpiresAt: 0 });
    expect(store.getSnapshot().wallet?.address).toBe(walletB.address);
  });
});
