/**
 * Tests that the console follows the connected wallet's own changes (monkey-trading/console#289): an
 * account switch connects the new account with its own key and reads, a wallet that shares no account
 * disconnects, a chain switch holds every wallet request with a line asking to switch back, and a 4100
 * refusal reads in plain words at its control.
 */

import { describe, expect, it } from "vitest";

import vectors from "../engine/eip712-vectors.json";
import { InjectedConnector } from "../engine/injected";
import { UNAUTHORIZED_ACCOUNT } from "../engine/provider-errors";
import { sessionKeyName } from "../engine/session-key-store";
import { settle } from "../engine/test-kit";
import { ACCOUNT, EventfulProvider, memoryStorage, type StubOptions } from "../engine/wallet-kit";
import { loadChoice } from "../engine/wallet-persist";
import { connected as pairedWallet } from "../engine/walletconnect-kit";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { connectWallet, deposit, placeOrder } from "./actions";
import { ActionClient, BTC, nextStore, VAULT } from "./live-kit";
import { moveToNode } from "./node-move";
import { ConsoleStore } from "./store";
import { WALLET_LEFT } from "./wallet-session";

const OTHER = "0x00000000000000000000000000000000000000bb";
const USDC = "0x00000000000000000000000000000000000000cc";
const keyName = (account: string) => sessionKeyName({ account, chainId: vectors.chain_id, vault: VAULT });
const signatures = (provider: EventfulProvider) => provider.calls.filter((call) => call.method === "eth_signTypedData_v4").length;
const AWAY = "Your wallet is on Ethereum, not Anvil. Switch it back to Anvil to continue.";

/** A tab whose browser wallet sends its events, connected as the user connects it: a declared account, so the connect asks for this browser's key. */
async function injectedTab(options: StubOptions = {}) {
  const storage = memoryStorage();
  const client = new ActionClient();
  client.credited = true;
  const provider = new EventfulProvider(options);
  const wallets = new InjectedConnector(() => provider, { chainId: vectors.chain_id, vault: VAULT, usdc: USDC, add: null }, { wait: async () => undefined });
  const store = new ConsoleStore({ client, wallets, persistence: storage, history: () => [], initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  store.start(0);
  await settle();
  expect(await connectWallet(store, "injected")).toBe(true);
  await settle();
  return { client, provider, storage, store };
}

describe("an account switch in the wallet", () => {
  it("connects the new account with its own key and reads, keeps the last account's key for it, and adopts that key again on switching back", async () => {
    const { client, provider, storage, store } = await injectedTab();
    expect(store.getSnapshot().sessionExpiresAt).toBeGreaterThan(0);
    expect(signatures(provider)).toBe(1);
    // A connection handed the same wallet again follows it once, never twice.
    expect(await connectWallet(store, "injected", true, store.liveWallet ?? undefined)).toBe(true);
    expect(provider.heard("accountsChanged")).toBe(1);
    const reads = client.chainsRead.length;
    provider.emit("accountsChanged", [OTHER]);
    await settle();
    expect(store.liveWallet?.address).toBe(OTHER);
    expect(store.getSnapshot().wallet).toMatchObject({ address: OTHER, label: "Browser wallet" });
    expect(store.getSnapshot()).toMatchObject({ sessionExpiresAt: 0, accountRead: true });
    expect(store.sessionKey).toBeNull();
    expect(client.chainsRead.length).toBe(reads + 1);
    expect(storage.held.has(keyName(ACCOUNT))).toBe(true);
    expect(client.posted.filter((p) => p.route === "session_key_revoke")).toEqual([]);
    provider.emit("accountsChanged", [ACCOUNT]);
    await settle();
    expect(store.liveWallet?.address).toBe(ACCOUNT);
    expect(store.getSnapshot().sessionExpiresAt).toBeGreaterThan(0);
    expect(signatures(provider)).toBe(1); // the stored key came back with no signature
  });

  it("follows a WalletConnect session's switch over the same session, ending nothing of it", async () => {
    const { fake, wallet } = await pairedWallet();
    const client = new ActionClient();
    const store = new ConsoleStore({ client, wallets: { options: [], connect: async () => wallet }, history: () => [], initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
    store.start(0);
    await settle();
    expect(await connectWallet(store, "walletconnect", true, wallet)).toBe(true);
    fake.emit("session_event", { id: 1, topic: "topic-1", params: { chainId: "eip155:31337", event: { name: "accountsChanged", data: [`eip155:31337:${OTHER}`] } } });
    await settle();
    expect(store.getSnapshot().wallet).toMatchObject({ address: OTHER, label: "WalletConnect" });
    expect(store.liveWallet?.topic).toBe("topic-1");
    expect(fake.disconnects).toBe(0);
  });
});

describe("a wallet that stops sharing an account", () => {
  it("disconnects with a line beside Connect, forgets the stored choice, revokes nothing, and keeps the account's key for its return", async () => {
    const { client, provider, storage, store } = await injectedTab();
    expect(loadChoice(storage)).toEqual({ kind: "injected" });
    provider.emit("accountsChanged", []);
    await settle();
    expect(store.liveWallet).toBeNull();
    expect(store.getSnapshot().wallet).toBeNull();
    expect(store.getSnapshot().notices.wallet).toEqual(expect.objectContaining({ tone: "info", text: WALLET_LEFT }));
    expect(loadChoice(storage)).toBeNull();
    expect(storage.held.has(keyName(ACCOUNT))).toBe(true);
    expect(client.posted.filter((p) => p.route === "session_key_revoke")).toEqual([]);
    // What it says after it was dropped changes nothing.
    provider.emit("accountsChanged", [OTHER]);
    await settle();
    expect(store.getSnapshot().wallet).toBeNull();
  });
});

describe("a chain switch in the wallet", () => {
  it("holds the wallet's requests with a line asking to switch back, lets this browser's key trade, and lets the requests go once it is back", async () => {
    const { client, provider, store } = await injectedTab({ balance: 50_000_000n });
    provider.emit("chainChanged", "0x1");
    expect(store.getSnapshot().walletChain).toBe(1);
    await deposit(store, fixedFromInt(10));
    expect(store.getSnapshot().notices.deposit).toEqual(expect.objectContaining({ tone: "error", text: AWAY }));
    expect(provider.sent).toEqual([]);
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
    // An order the browser's key signs asks nothing of the wallet, so it goes.
    expect(await placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false })).toBe(true);
    expect(client.posted.map((p) => p.route)).toContain("order");
    provider.emit("chainChanged", "0x7a69");
    expect(store.getSnapshot().walletChain).toBeNull();
    await deposit(store, fixedFromInt(10));
    expect(store.getSnapshot().notices.deposit?.tone).not.toBe("error");
    expect(provider.sent).toHaveLength(2); // the approval, then the deposit
  });

  it("keeps the hold across an account switch while the wallet stays away, and drops it with the connection", async () => {
    const { provider, store } = await injectedTab();
    provider.emit("chainChanged", "0x1");
    provider.emit("accountsChanged", [OTHER]);
    await settle();
    expect(store.getSnapshot().wallet?.address).toBe(OTHER);
    expect(store.getSnapshot().walletChain).toBe(1);
    provider.emit("accountsChanged", []);
    expect(store.getSnapshot().walletChain).toBeNull();
  });

  it("drops the hold for a connect the user makes, which puts the wallet back on the deployment's chain", async () => {
    const { provider, store } = await injectedTab();
    provider.emit("chainChanged", "0x1");
    expect(await connectWallet(store, "injected")).toBe(true);
    expect(provider.chainId).toBe(31337);
    expect(store.getSnapshot().walletChain).toBeNull();
  });

  it("carries the hold to another node's store, where the wallet's events go on being followed", async () => {
    const { provider, store } = await injectedTab();
    provider.emit("chainChanged", "0x1");
    const next = nextStore();
    await moveToNode(store, next.store);
    expect(next.store.getSnapshot().walletChain).toBe(1);
    provider.emit("chainChanged", "0x7a69");
    expect(next.store.getSnapshot().walletChain).toBeNull();
    expect(store.getSnapshot().walletChain).toBe(1); // the store left behind hears nothing more
    expect(provider.heard("chainChanged")).toBe(1);
  });
});

describe("a 4100 refusal", () => {
  it("reads in plain words at the control that asked", async () => {
    const { store } = await injectedTab({ balance: 50_000_000n, fail: { eth_sendTransaction: { code: 4100, message: "The requested account and/or method has not been authorized by the user." } } });
    await deposit(store, fixedFromInt(10));
    expect(store.getSnapshot().notices.deposit).toEqual(expect.objectContaining({ tone: "error", text: UNAUTHORIZED_ACCOUNT }));
  });
});
