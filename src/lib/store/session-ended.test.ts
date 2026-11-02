/** Tests for a session key that dies: expired in storage or on the sequenced clock, revoked on the stream, or refused by the node. Each disconnects with no prompt and says why. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import vectors from "../engine/eip712-vectors.json";
import { SESSION_KEY_TTL_MS, SessionKeySigner } from "../engine/session-key";
import { saveSessionKey, sessionKeyName, type KeyScope } from "../engine/session-key-store";
import { settle } from "../engine/test-kit";
import { ACCOUNT, memoryStorage } from "../engine/wallet-kit";
import { loadChoice, saveChoice } from "../engine/wallet-persist";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { connectWallet, placeOrder } from "./actions";
import { authorizedTab, loadedTab, NODE_TIME, tab, VAULT } from "./live-kit";
import { reconnectWallet } from "./reconnect";
import { liveSessionKey } from "./session";
import type { ConsoleStore } from "./store";
import { noteSessionRevoked } from "./wallet-session";

const SCOPE: KeyScope = { account: ACCOUNT, chainId: vectors.chain_id, vault: VAULT };
const NAME = sessionKeyName(SCOPE);
const EXPIRES = NODE_TIME + SESSION_KEY_TTL_MS;
const order = (store: ConsoleStore) => placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });
const signatures = (provider: { calls: { method: string }[] }) => provider.calls.filter((c) => c.method === "eth_signTypedData_v4");

describe("a stored key that expired", () => {
  it("ends a reload that knows the clock: no prompt, the choice forgotten, and a notice", async () => {
    const storage = memoryStorage();
    saveSessionKey(storage, SCOPE, SessionKeySigner.generate(), EXPIRES);
    saveChoice(storage, { kind: "injected" });
    const { client, provider, store } = await tab(storage);
    store.patch({ now: EXPIRES });
    expect(await connectWallet(store, "injected", true)).toBe(false);
    expect(store.getSnapshot().wallet).toBeNull();
    expect(loadChoice(storage)).toBeNull();
    expect(storage.held.has(NAME)).toBe(false);
    expect(store.getSnapshot().notices.wallet).toMatchObject({ tone: "info", text: expect.stringContaining("expired") });
    expect(client.posted).toEqual([]);
    expect(provider.calls.filter((c) => c.method !== "eth_requestAccounts")).toEqual([]);
  });

  it("ends a reload that learns the clock later, at the first frame, with no popup first", async () => {
    const storage = memoryStorage();
    saveSessionKey(storage, SCOPE, SessionKeySigner.generate(), EXPIRES);
    const { client, provider, store } = await loadedTab(storage);
    expect(store.getSnapshot().setup.open).toBe(false);
    client.deliver({ offset: "1:0", type: "command", seq: 1, ts: EXPIRES + 1, cmd: { type: "tick" }, events: [] });
    expect(store.getSnapshot().wallet).toBeNull();
    expect(storage.held.has(NAME)).toBe(false);
    expect(signatures(provider)).toEqual([]);
  });

  it("is discarded for the pairing a WalletConnect reload falls back to, which the user just approved: the wallet is asked for a new key, and the session stays", async () => {
    const storage = memoryStorage();
    const old = SessionKeySigner.generate();
    saveSessionKey(storage, SCOPE, old, NODE_TIME); // expired by the node's own clock, which a new key's expiry follows
    saveChoice(storage, { kind: "walletconnect", topic: "old-topic" });
    const { client, provider, store, wallet } = await tab(storage);
    client.credited = true;
    let released = 0;
    wallet.disconnect = async () => void (released += 1);
    store.patch({ now: NODE_TIME });
    await reconnectWallet(store, { resume: async () => null, pairing: () => ({ status: "idle" }) }, () => false);
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    expect(released).toBe(0);
    await settle();
    expect(liveSessionKey(store)?.address).not.toBe(old.address);
    expect(signatures(provider)).toHaveLength(1);
    expect(store.getSnapshot().setup.open).toBe(false);
    expect(store.getSnapshot().notices.wallet).toBeUndefined();
  });

  it("ends a WalletConnect session a reload re-attached by itself, as any expiry does", async () => {
    const storage = memoryStorage();
    saveSessionKey(storage, SCOPE, SessionKeySigner.generate(), EXPIRES);
    saveChoice(storage, { kind: "walletconnect", topic: "topic-1" });
    const { store, wallet } = await tab(storage);
    wallet.topic = "topic-1";
    store.patch({ now: EXPIRES });
    await reconnectWallet(store, { resume: async () => wallet, pairing: () => ({ status: "idle" }) }, () => false);
    expect(store.getSnapshot().wallet).toBeNull();
    expect(loadChoice(storage)).toBeNull();
    expect(store.getSnapshot().notices.wallet).toMatchObject({ tone: "info", text: expect.stringContaining("expired") });
  });

  it("is discarded for a connect the user pressed, which goes straight to the wallet's signature for a new key, with no popup", async () => {
    const storage = memoryStorage();
    const old = SessionKeySigner.generate();
    saveSessionKey(storage, SCOPE, old, NODE_TIME); // expired by the node's own clock, which a new key's expiry follows
    const { client, provider, store } = await tab(storage);
    client.credited = true;
    store.patch({ now: NODE_TIME });
    expect(await connectWallet(store, "injected")).toBe(true);
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    await settle();
    expect(liveSessionKey(store)?.address).not.toBe(old.address);
    expect(signatures(provider)).toHaveLength(1);
    expect(store.getSnapshot().setup.open).toBe(false);
  });
});

describe("a key that dies while connected", () => {
  it("disconnects when the sequenced clock reaches its expiry, at the exact instant: no prompt, the choice and key gone, and a notice", async () => {
    const { client, provider, storage, store } = await authorizedTab();
    saveChoice(storage, { kind: "injected" });
    client.deliver({ offset: "1:0", type: "command", seq: 1, ts: EXPIRES - 1, cmd: { type: "tick" }, events: [] });
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    const prompts = signatures(provider).length;
    client.deliver({ offset: "2:0", type: "command", seq: 2, ts: EXPIRES, cmd: { type: "tick" }, events: [] });
    await settle();
    expect(store.getSnapshot().wallet).toBeNull();
    expect(store.liveWallet).toBeNull();
    expect(loadChoice(storage)).toBeNull();
    expect(storage.held.has(NAME)).toBe(false);
    expect(store.getSnapshot().notices.wallet).toMatchObject({ tone: "info", text: "This browser's trading authorization expired, so your wallet was disconnected. Connect again to renew it." });
    expect(signatures(provider)).toHaveLength(prompts);
    expect(client.posted.some((p) => p.route === "session_key_revoke")).toBe(false);
  });

  it.each(["invalid signature", "session key revoked", "session key expired"])("disconnects on the first refusal saying %s, retries nothing, and says why; reconnecting asks the wallet for a new key, with no popup", async (message) => {
    const { client, provider, storage, store } = await authorizedTab();
    saveChoice(storage, { kind: "injected" });
    const prompts = signatures(provider).length;
    client.answer = (posted) => {
      if (posted.route === "order") throw new EngineError(401, message, { kind: "invalid_signature" });
      return { seq: 1, events: [{ type: "session_key_registered", account: ACCOUNT, session_key: (posted.body as { session_key: string }).session_key, expires_at: EXPIRES }] };
    };
    expect(await order(store)).toBe(false);
    expect(client.posted.filter((p) => p.route === "order")).toHaveLength(1);
    expect(store.getSnapshot().wallet).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ busy: false });
    expect(loadChoice(storage)).toBeNull();
    expect(storage.held.has(NAME)).toBe(false);
    expect(store.getSnapshot().notices.wallet).toMatchObject({ tone: "info", text: "The node no longer accepts this browser's trading authorization, so your wallet was disconnected. Connect again to renew it." });
    expect(signatures(provider)).toHaveLength(prompts);
    await connectWallet(store, "injected");
    await settle();
    expect(store.getSnapshot().setup.open).toBe(false);
    expect(store.getSnapshot().eligibility).toBe("professional");
    expect(signatures(provider)).toHaveLength(prompts + 1);
    expect(liveSessionKey(store)).not.toBeNull();
  });

  it("is refused the first time when it never landed: a stored key the node does not know", async () => {
    const storage = memoryStorage();
    saveSessionKey(storage, SCOPE, SessionKeySigner.generate(), EXPIRES);
    const { client, store } = await loadedTab(storage);
    expect(liveSessionKey(store)).not.toBeNull();
    client.answer = () => { throw new EngineError(401, "invalid signature"); };
    await order(store);
    expect(store.getSnapshot().wallet).toBeNull();
    expect(storage.held.has(NAME)).toBe(false);
  });

  it("disconnects on a stream revocation naming this key, and ignores one naming another key or account", async () => {
    const { client, provider, storage, store } = await authorizedTab();
    saveChoice(storage, { kind: "injected" });
    const key = liveSessionKey(store)?.address;
    if (key === undefined) throw new Error("no key");
    const revoked = (account: string, sessionKey: string) => client.deliver({ offset: "1:0", type: "command", seq: 1, ts: NODE_TIME, cmd: { type: "revoke_session_key" }, events: [{ type: "session_key_revoked", account, session_key: sessionKey }] });
    revoked(ACCOUNT, "0x0000000000000000000000000000000000000abc");
    revoked("0x0000000000000000000000000000000000000abc", key);
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    const prompts = signatures(provider).length;
    revoked(ACCOUNT, key.toUpperCase().replace("0X", "0x"));
    expect(store.getSnapshot().wallet).toBeNull();
    expect(loadChoice(storage)).toBeNull();
    expect(storage.held.has(NAME)).toBe(false);
    expect(store.getSnapshot().notices.wallet).toMatchObject({ tone: "info", text: expect.stringContaining("was revoked") });
    expect(signatures(provider)).toHaveLength(prompts);
  });
});

describe("a stream revocation", () => {
  it("does not disconnect for this key's address under another account: anyone may register a public address and revoke it", async () => {
    const { store } = await authorizedTab();
    const key = liveSessionKey(store)?.address;
    if (key === undefined) throw new Error("no key");
    noteSessionRevoked(store, [{ type: "session_key_revoked", account: "0x0000000000000000000000000000000000000abc", session_key: key }]);
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
  });
});
