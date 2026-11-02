/** Tests for what a connect asks of the wallet (one key signature, for a declared wallet and a connect the user pressed), and for a connect replacing another wallet. */

import { describe, expect, it } from "vitest";

import vectors from "../engine/eip712-vectors.json";
import { ProviderWallet } from "../engine/provider-wallet";
import type { KeyStorage } from "../engine/session-key-store";
import { ACCOUNT, memoryStorage, StubProvider, type StubOptions } from "../engine/wallet-kit";
import { loadChoice } from "../engine/wallet-persist";
import type { Wallet } from "../engine/wallet";
import { authorizeBrowser, connectWallet, disconnectWallet } from "./actions";
import { ActionClient, BTC, NODE_TIME, VAULT } from "./live-kit";
import { liveSessionKey } from "./session";
import { ConsoleStore } from "./store";
import { settle } from "../engine/test-kit";

/** A started store over an ActionClient that records what it is sent. */
async function setup(credited: boolean, persistence?: KeyStorage, options: StubOptions = {}) {
  const client = new ActionClient();
  client.credited = credited;
  const provider = new StubProvider(options);
  const walletA: Wallet = new ProviderWallet(ACCOUNT, "Test wallet", provider, { chainId: vectors.chain_id, vault: VAULT, usdc: null, add: null }, { wait: async () => {} });
  const store = new ConsoleStore({ client, wallets: { options: [], connect: async () => walletA }, ...(persistence === undefined ? {} : { persistence }), history: () => [], initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  store.start(0);
  await settle();
  return { client, provider, store, walletA };
}

const signatures = (provider: StubProvider) => provider.calls.filter((c) => c.method === "eth_signTypedData_v4");

describe("what a connect hands the node's client", () => {
  it("gives it the wallet's chain reads before the account is read, and takes them back at a disconnect", async () => {
    const { client, store, walletA } = await setup(true);
    let chainsAtAccountRead = -1;
    const read = client.account.bind(client);
    client.account = () => { chainsAtAccountRead = client.chainsRead.length; return read(); };
    await connectWallet(store, "injected");
    expect(walletA.chainReads).toBeDefined();
    expect(client.chainsRead).toEqual([walletA.chainReads]);
    expect(chainsAtAccountRead).toBe(1);
    disconnectWallet(store);
    expect(client.chainsRead).toEqual([walletA.chainReads, null]);
  });
});

describe("a connect that ended while the wallet answered the vault's read", () => {
  it("stores nothing, adopts nothing and offers nothing once the wallet has been disconnected", async () => {
    const storage = memoryStorage();
    const { client, provider, store, walletA } = await setup(true, storage);
    let answer = () => {};
    client.readChainThrough = async (chain: unknown) => { if (chain !== null) await new Promise<void>((resolve) => { answer = resolve; }); };
    walletA.suggestUsdc = async () => { provider.calls.push({ method: "offered" } as never); return false; };
    const connecting = connectWallet(store, "injected");
    await settle();
    disconnectWallet(store);
    answer();
    await expect(connecting).resolves.toBe(false);
    expect(loadChoice(storage)).toBeNull();
    expect(provider.calls.some((c) => c.method === "offered")).toBe(false);
    expect(store.getSnapshot().wallet).toBeNull();
  });

  it("offers the USDC only once the read has settled, so the prompt does not hold the wallet from answering it", async () => {
    const { client, provider, store, walletA } = await setup(true);
    let answer = () => {};
    client.readChainThrough = async () => { await new Promise<void>((resolve) => { answer = resolve; }); };
    walletA.suggestUsdc = async () => { provider.calls.push({ method: "offered" } as never); return false; };
    const connecting = connectWallet(store, "injected");
    await settle();
    expect(provider.calls.some((c) => c.method === "offered")).toBe(false);
    answer();
    await connecting;
    expect(provider.calls.some((c) => c.method === "offered")).toBe(true);
  });
});

describe("what a connect asks of the wallet", () => {
  it("asks a declared wallet for the one key signature straight after a connect the user pressed, credited or not", async () => {
    for (const credited of [true, false]) {
      const { client, provider, store } = await setup(credited);
      expect(await connectWallet(store, "injected")).toBe(true);
      await settle();
      expect(signatures(provider)).toHaveLength(1);
      expect(client.posted.map((p) => p.route)).toEqual(["session_key"]);
      expect(liveSessionKey(store)).not.toBeNull();
      expect(store.getSnapshot().setup.open).toBe(false); // no popup for a declared wallet
    }
  });

  it("asks for nothing on a quiet reconnect at page load, and leaves the key for the deal ticket's button to ask", async () => {
    for (const credited of [true, false]) {
      const { client, provider, store } = await setup(credited);
      expect(await connectWallet(store, "injected", true)).toBe(true);
      await settle();
      expect(client.posted).toEqual([]);
      expect(signatures(provider)).toEqual([]);
      expect(liveSessionKey(store)).toBeNull();
    }
  });

  it("asks an undeclared wallet for nothing at connect: its popup takes the declaration first", async () => {
    const { client, provider, store } = await setup(false);
    client.declared = null;
    await connectWallet(store, "injected");
    await settle();
    expect(signatures(provider)).toEqual([]);
    expect(store.getSnapshot().setup.open).toBe(true);
  });

  it("leaves a declined prompt alone: no key, no popup, the reason in a toast", async () => {
    const { client, store } = await setup(true, undefined, { fail: { eth_signTypedData_v4: { code: 4001, message: "User rejected" } } });
    await connectWallet(store, "injected");
    await settle();
    expect(liveSessionKey(store)).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ busy: false, setup: { open: false } });
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("You declined to sign in your wallet.");
    expect(client.posted).toEqual([]);
  });

  it("registers nothing when the account's credit arrives: a deposit, or a deposit credited on a screening retry", async () => {
    const { client, provider, store } = await setup(false);
    await connectWallet(store, "injected", true);
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
    const { client, store } = await setup(true);
    const walletB: Wallet = { address: "0x0000000000000000000000000000000000000bbb", label: "Other", sign: async () => "0x", deposit: async () => "0x0", claim: async () => "0x0" };
    await connectWallet(store, "injected");
    await authorizeBrowser(store);
    await settle();
    const keyOfA = liveSessionKey(store);
    if (keyOfA === null) throw new Error("no key for wallet A");
    store.patch({ sessionRefusal: { kind: "session_key_unsupported" } });
    store.deps.wallets.connect = async () => walletB;
    client.declared = null; // so the new wallet has a popup and no prompt
    await connectWallet(store, "other");
    expect(liveSessionKey(store)).toBeNull();
    expect(store.sessionKey).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ sessionRefusal: null, sessionExpiresAt: 0 });
    expect(store.getSnapshot().wallet?.address).toBe(walletB.address);
  });
});
