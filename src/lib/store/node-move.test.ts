/** Tests for a switch of node: what crosses it (the wallet and its session key), and what cannot (anything read from the old node). */

import { describe, expect, it } from "vitest";

import { settle } from "../engine/test-kit";
import type { OperatorFollower } from "../engine/operator-follow";
import { loadSessionKey } from "../engine/session-key-store";
import { authorizeBrowser, connectWallet } from "./actions";
import { memoryStorage } from "../engine/wallet-kit";
import { loadChoice, saveChoice } from "../engine/wallet-persist";
import { authorizedTab, nextStore, tab } from "./live-kit";
import { followNode, moveNotice, moveToNode, recheckNode } from "./node-move";
import { reconnectWallet } from "./reconnect";
import { keyScope, liveSessionKey } from "./session";

describe("moveToNode", () => {
  it("carries the wallet and its session key to the new store, asking the wallet for nothing", async () => {
    const old = await authorizedTab();
    const key = old.store.sessionKey;
    const signaturesBefore = old.provider.calls.filter((c) => c.method === "eth_signTypedData_v4").length;
    const next = nextStore(old.storage);
    await moveToNode(old.store, next.store);
    expect(next.store.liveWallet).toBe(old.wallet);
    expect(next.store.getSnapshot().wallet?.address).toBe(old.wallet.address);
    expect(key).not.toBeNull();
    expect(next.store.sessionKey).toBe(key);
    expect(liveSessionKey(next.store)).toBe(key);
    expect(old.provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(signaturesBefore);
  });

  it("leaves the stored key where it was: its entry names the account, chain and vault, and no node", async () => {
    const old = await authorizedTab();
    const next = nextStore(old.storage);
    await moveToNode(old.store, next.store);
    const stored = loadSessionKey(old.storage, keyScope(next.store, old.wallet), 1);
    expect(stored.kind).toBe("live");
    expect(stored.kind === "live" && stored.signer.address).toBe(next.store.sessionKey?.address);
  });

  it("carries a key that lives only in memory, where storage was denied", async () => {
    const old = await authorizedTab();
    old.storage.removeItem(`monkeytrading.session-key.31337.${old.client.deployment.vault.toLowerCase()}.${old.wallet.address.toLowerCase()}`);
    const key = old.store.sessionKey;
    const next = nextStore(old.storage);
    await moveToNode(old.store, next.store);
    expect(next.store.sessionKey).toBe(key);
  });

  it("adopts the stored key where the old connection held none, as a tab that never authorized", async () => {
    const storage = memoryStorage();
    const first = await authorizedTab(storage);
    const second = await tab(storage);
    second.client.credited = true;
    second.store.liveWallet = first.wallet;
    const next = nextStore(storage);
    await moveToNode(second.store, next.store);
    expect(next.store.sessionKey?.address).toBe(first.store.sessionKey?.address);
  });

  it("takes the wallet from the old store, so work it has in flight finds no wallet and sends nothing", async () => {
    const old = await authorizedTab();
    const next = nextStore(old.storage);
    await moveToNode(old.store, next.store);
    expect(old.store.liveWallet).toBeNull();
    expect(old.store.sessionKey).toBeNull();
    expect(await authorizeBrowser(old.store, "setup")).toBe(false);
    expect(old.client.posted.filter((p) => p.route === "session_key")).toHaveLength(1);
  });

  it("does not end the wallet's connection, which the new store goes on using", async () => {
    const old = await authorizedTab();
    let disconnects = 0;
    old.wallet.disconnect = async () => { disconnects += 1; };
    await moveToNode(old.store, nextStore(old.storage).store);
    await settle();
    expect(disconnects).toBe(0);
  });

  it("starts the new store with nothing read from the old node, and reads the account from the new one", async () => {
    const old = await authorizedTab();
    old.client.credited = true;
    await old.store.refresh(true);
    expect(old.store.getSnapshot().account).not.toBeNull();
    const next = nextStore(old.storage);
    next.client.credited = false;
    const untouched = next.store.getSnapshot();
    expect([untouched.account, untouched.queue, untouched.history]).toEqual([null, [], []]);
    let accountReads = 0;
    const read = next.client.account.bind(next.client);
    next.client.account = () => { accountReads += 1; return read(); };
    await moveToNode(old.store, next.store);
    expect(next.store.getSnapshot().account).toBeNull();
    expect(accountReads).toBeGreaterThan(0);
  });

  it("says where the console went only as a node the chain names, never as a change of operator it may not have seen", () => {
    expect(moveNotice("b.example")).toBe("The console connected to b.example, the node the chain names, and is verifying its attestation.");
  });

  it("marks the old store moved, so the reconnect it was running does not forget the choice the new store saved", async () => {
    const storage = memoryStorage();
    const old = await tab(storage);
    saveChoice(storage, { kind: "injected" });
    let answer = () => {};
    old.client.readChainThrough = async () => { await new Promise<void>((resolve) => { answer = resolve; }); };
    const reconnecting = reconnectWallet(old.store, null, () => true);
    await settle();
    await moveToNode(old.store, nextStore(storage).store);
    answer();
    await reconnecting;
    expect(loadChoice(storage)).toEqual({ kind: "injected" });
  });

  it("moves a session with no wallet, connecting nothing", async () => {
    const old = await tab(memoryStorage());
    const next = nextStore();
    await moveToNode(old.store, next.store);
    expect(next.store.liveWallet).toBeNull();
    expect(next.store.getSnapshot().wallet).toBeNull();
  });
});

describe("followNode", () => {
  /** A follower that counts its checks and the clients it watches. */
  function follower() {
    const seen = { checks: 0, watching: 0 };
    const stub = { check: async () => { seen.checks += 1; }, watch: () => { seen.watching += 1; return () => { seen.watching -= 1; }; } };
    // Only `check` and `watch` are used.
    return { stub: stub as unknown as OperatorFollower, seen };
  }

  it("reads the chain when the wallet changes, and not on other changes", async () => {
    const { store } = await tab(memoryStorage());
    const { stub, seen } = follower();
    const stop = followNode(store, stub);
    expect(seen.watching).toBe(1);
    store.patch({ busy: true });
    expect(seen.checks).toBe(0);
    await connectWallet(store, "injected");
    expect(seen.checks).toBe(1);
    stop();
    expect(seen.watching).toBe(0);
    store.liveWallet = null;
    store.patch({ busy: false });
    expect(seen.checks).toBe(1);
  });
});

describe("recheckNode", () => {
  it("asks the wallet back onto the chain, then judges the node again", async () => {
    const { store, client, provider, wallet } = await tab(memoryStorage());
    store.liveWallet = wallet;
    let verifies = 0;
    client.verify = async () => { verifies += 1; return { kind: "mock" }; };
    let checks = 0;
    await recheckNode(store, { check: async () => { checks += 1; } });
    expect(provider.calls.some((c) => c.method === "eth_chainId")).toBe(true);
    expect([verifies, checks]).toEqual([1, 1]);
  });

  it("says why when the wallet stays on another chain, and judges nothing", async () => {
    const { store, client, wallet } = await tab(memoryStorage());
    store.liveWallet = wallet;
    wallet.ensureChain = async () => { throw new Error("Your wallet is on chain 1."); };
    let verifies = 0;
    client.verify = async () => { verifies += 1; return { kind: "mock" }; };
    let checks = 0;
    await recheckNode(store, { check: async () => { checks += 1; } });
    expect([verifies, checks]).toEqual([0, 0]);
    expect(store.getSnapshot().notices.node?.text).toBe("Your wallet is on chain 1.");
  });
});
