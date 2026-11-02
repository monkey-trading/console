/** Tests for the session key across page loads: stored only once registered, reused with no signature, and removed whenever it dies. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import vectors from "../engine/eip712-vectors.json";
import { SESSION_KEY_TTL_MS, SessionKeySigner } from "../engine/session-key";
import { saveSessionKey, sessionKeyName, type KeyScope } from "../engine/session-key-store";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { ACCOUNT, memoryStorage } from "../engine/wallet-kit";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { authorizeBrowser, connectWallet, disconnectWallet, placeOrder, walletSessionEnded } from "./actions";
import { authorizedTab, loadedTab, NODE_TIME, tab, VAULT } from "./live-kit";
import { liveSessionKey } from "./session";
import type { ConsoleStore } from "./store";

const SCOPE: KeyScope = { account: ACCOUNT, chainId: vectors.chain_id, vault: VAULT };
const NAME = sessionKeyName(SCOPE);
const EXPIRES = NODE_TIME + SESSION_KEY_TTL_MS;
const order = (store: ConsoleStore) => placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });
const signatures = (provider: { calls: { method: string }[] }) => provider.calls.filter((c) => c.method === "eth_signTypedData_v4");

describe("storing the key", () => {
  it("stores it with its expiry only once the node has registered it", async () => {
    const storage = memoryStorage();
    const { client, store } = await tab(storage);
    await connectWallet(store, "injected");
    client.answer = () => { throw new EngineError(0, "The node did not answer."); };
    await authorizeBrowser(store, "setup");
    expect(storage.held.has(NAME)).toBe(false); // a registration whose answer never came
    client.answer = () => ({ seq: 1, events: [{ type: "session_key_rejected", account: ACCOUNT, session_key: "0x0", reason: { kind: "too_many_session_keys", max: 10 } }] });
    await authorizeBrowser(store, "setup");
    expect(storage.held.has(NAME)).toBe(false); // a refused one
    client.answer = (posted) => ({ seq: 1, events: [{ type: "session_key_registered", account: ACCOUNT, session_key: (posted.body as { session_key: string }).session_key, expires_at: EXPIRES }] });
    await authorizeBrowser(store, "setup");
    const key = liveSessionKey(store);
    if (key === null) throw new Error("no key");
    expect(JSON.parse(storage.held.get(NAME) ?? "{}")).toEqual({ privateKey: key.exportPrivateKey(), address: key.address, account: ACCOUNT, chainId: vectors.chain_id, vault: VAULT.toLowerCase(), expiresAt: EXPIRES });
  });

  it("keeps the private key out of the snapshot and every message", async () => {
    const { client, store } = await authorizedTab();
    const key = liveSessionKey(store);
    if (key === null) throw new Error("no key");
    client.answer = () => { throw new EngineError(401, "session key revoked"); };
    const snapshots: unknown[] = [store.getSnapshot()];
    store.subscribe(() => snapshots.push(store.getSnapshot()));
    await order(store);
    const written = JSON.stringify(snapshots, (_, value: unknown) => (typeof value === "bigint" ? String(value) : value));
    expect(written).not.toContain(key.exportPrivateKey().slice(2));
    expect(store.getSnapshot().sessionExpiresAt).toBe(0);
  });
});

describe("a reload or a new tab", () => {
  it("reuses a valid stored key with no signature and no popup, and trades on it silently", async () => {
    const { storage, store: first } = await authorizedTab();
    const key = liveSessionKey(first);
    const { client, provider, store } = await loadedTab(storage);
    expect(liveSessionKey(store)?.address).toBe(key?.address);
    expect(store.getSnapshot().setup).toMatchObject({ open: false, decided: true });
    await order(store);
    expect(client.posted.map((p) => p.route)).toEqual(["order"]);
    expect(signatures(provider)).toEqual([]);
  });

  it("never reuses another account's key: that wallet has none, and a reload asks it nothing", async () => {
    const storage = memoryStorage();
    saveSessionKey(storage, { ...SCOPE, account: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" }, SessionKeySigner.generate(), EXPIRES);
    const { client, store } = await loadedTab(storage);
    expect(liveSessionKey(store)).toBeNull();
    expect(store.getSnapshot().setup.open).toBe(false);
    expect(client.posted).toEqual([]);
  });

  it("discards a malformed entry, asking nothing at the reload", async () => {
    const storage = memoryStorage();
    storage.setItem(NAME, "{\"privateKey\":\"nope\"}");
    const { store } = await loadedTab(storage);
    expect(liveSessionKey(store)).toBeNull();
    expect(storage.held.has(NAME)).toBe(false);
    expect(store.getSnapshot().setup.open).toBe(false);
  });

  it("adopts nothing for a read-only watch account, and leaves the stored key to its wallet's tabs", async () => {
    const storage = memoryStorage();
    saveSessionKey(storage, SCOPE, SessionKeySigner.generate(), EXPIRES);
    const { store } = await tab(storage);
    const watch: Wallet = { address: ACCOUNT, label: "Watching", readOnly: true, sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" };
    await connectWallet(store, "watch", true, watch);
    expect(store.sessionKey).toBeNull();
    expect(store.getSnapshot().setup.open).toBe(false);
    disconnectWallet(store);
    expect(storage.held.has(NAME)).toBe(true);
  });

  it("keeps working in memory when storage is denied, and asks again on the next load", async () => {
    const denied = { ...memoryStorage(), setItem(): void { throw new Error("denied"); }, getItem(): string { throw new Error("denied"); } };
    const { store } = await tab(denied);
    await connectWallet(store, "injected");
    expect(await authorizeBrowser(store, "setup")).toBe(true);
    expect(liveSessionKey(store)).not.toBeNull();
    const reloaded = await tab(denied);
    await connectWallet(reloaded.store, "injected", true);
    expect(liveSessionKey(reloaded.store)).toBeNull();
    expect(reloaded.store.getSnapshot().setup.open).toBe(false);
  });
});

describe("the sweep of dead entries", () => {
  it("waits for a connection to adopt its own, then removes other accounts' dead entries once the clock is known", async () => {
    const storage = memoryStorage();
    const other = sessionKeyName({ ...SCOPE, account: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" });
    saveSessionKey(storage, { ...SCOPE, account: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" }, SessionKeySigner.generate(), NODE_TIME - 1);
    const { store } = await tab(storage);
    store.patch({ now: NODE_TIME });
    expect(storage.held.has(other)).toBe(true); // no connection yet
    await connectWallet(store, "injected");
    store.patch({ now: NODE_TIME + 1 });
    expect(storage.held.has(other)).toBe(false);
  });
});

describe("leaving", () => {
  it("removes the key at Disconnect before the wallet has answered, and whether it signs or not", async () => {
    const { provider, storage, store, wallet } = await authorizedTab();
    wallet.sign = async () => { throw new Error("You declined to sign in your wallet."); };
    disconnectWallet(store);
    expect(storage.held.has(NAME)).toBe(false);
    await settle();
    expect(signatures(provider)).toHaveLength(1); // the registration's alone: the declined revocation never reached the provider
    expect(store.getSnapshot().notices.wallet).toMatchObject({ text: "The trading authorization was not revoked; it expires on its own." });
  });

  it("revokes a key adopted from storage through a WalletConnect pairing before it ends that pairing", async () => {
    const { storage, store: first } = await authorizedTab();
    const key = liveSessionKey(first)?.address;
    const { client, provider, store, wallet } = await loadedTab(storage);
    const order: string[] = [];
    wallet.topic = "topic-1";
    const sign = wallet.sign.bind(wallet);
    wallet.sign = async (request) => { order.push("signed"); return sign(request); };
    wallet.disconnect = async () => void order.push("released");
    disconnectWallet(store);
    await settle();
    expect(order).toEqual(["signed", "released"]);
    expect((client.posted.find((p) => p.route === "session_key_revoke")?.body as { session_key: string }).session_key).toBe(key);
    expect(signatures(provider)).toHaveLength(1);
    expect(storage.held.has(NAME)).toBe(false);
  });

  it("removes the key when the wallet app ends the session, which cannot sign a revocation", async () => {
    const { client, storage, store } = await authorizedTab();
    if (store.liveWallet === null) throw new Error("no wallet");
    store.liveWallet = { ...store.liveWallet, label: "WalletConnect", address: ACCOUNT };
    walletSessionEnded(store, "topic-1");
    expect(storage.held.has(NAME)).toBe(false);
    expect(client.posted.some((p) => p.route === "session_key_revoke")).toBe(false);
  });

  it("keeps a key for the wallet a connect replaced, which reuses it when it comes back", async () => {
    const { storage, store, wallet } = await authorizedTab();
    const key = liveSessionKey(store)?.address;
    const other: Wallet = { address: "0x0000000000000000000000000000000000000bbb", label: "Other", sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" };
    await connectWallet(store, "other", false, other);
    expect(storage.held.has(NAME)).toBe(true);
    expect(liveSessionKey(store)).toBeNull();
    await connectWallet(store, "injected", false, wallet);
    expect(liveSessionKey(store)?.address).toBe(key);
  });
});
