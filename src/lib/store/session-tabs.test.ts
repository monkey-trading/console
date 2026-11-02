/** Tests for two tabs sharing one stored key: what one tab's write does to the other, and the race for the key's nonce. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import vectors from "../engine/eip712-vectors.json";
import { SessionKeySigner } from "../engine/session-key";
import { saveSessionKey, sessionKeyName } from "../engine/session-key-store";
import { settle } from "../engine/test-kit";
import type { CancelRequest } from "../engine/types";
import { ACCOUNT, memoryStorage } from "../engine/wallet-kit";
import { loadChoice, saveChoice } from "../engine/wallet-persist";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { authorizeBrowser, cancelOrder, connectWallet, disconnectWallet, placeOrder, storedKeyChanged } from "./actions";
import { ActionClient, NODE_TIME, tab, VAULT } from "./live-kit";
import { liveSessionKey } from "./session";

const SCOPE = { account: ACCOUNT, chainId: vectors.chain_id, vault: VAULT };
const NAME = sessionKeyName(SCOPE);

/** Two connected tabs on one storage, the first authorized, each having adopted the same key; the storage events have reached the second. */
async function twoTabs() {
  const storage = memoryStorage();
  const a = await tab(storage);
  a.client.credited = true;
  await connectWallet(a.store, "injected");
  await authorizeBrowser(a.store);
  const b = await tab(storage);
  b.client.credited = true;
  await connectWallet(b.store, "injected", true);
  return { storage, a, b };
}

const signatures = (provider: { calls: { method: string }[] }) => provider.calls.filter((c) => c.method === "eth_signTypedData_v4");

describe("one tab's removal of the shared key", () => {
  it("disconnects the other tab with no prompt, while only the first revokes", async () => {
    const { storage, a, b } = await twoTabs();
    expect(liveSessionKey(b.store)?.address).toBe(liveSessionKey(a.store)?.address);
    expect(signatures(b.provider)).toEqual([]);
    disconnectWallet(a.store);
    await settle();
    expect(a.client.posted.some((p) => p.route === "session_key_revoke")).toBe(true);
    storedKeyChanged(b.store, NAME, storage.getItem(NAME)); // the storage event, as the browser fires it in the other tab
    await settle();
    expect(b.store.getSnapshot().wallet).toBeNull();
    expect(b.store.getSnapshot().toasts.at(-1)?.text).toBe("This browser's trading authorization ended in another tab, so your wallet was disconnected here too. Connect again to renew it.");
    expect(signatures(b.provider)).toEqual([]);
    expect(b.client.posted).toEqual([]);
  });

  it("disconnects the other tab when the whole storage is cleared", async () => {
    const { b } = await twoTabs();
    storedKeyChanged(b.store, null, null);
    expect(b.store.getSnapshot().wallet).toBeNull();
  });

  it("leaves a stored choice the first tab has since saved again", async () => {
    const { storage, b } = await twoTabs();
    saveChoice(storage, { kind: "walletconnect", topic: "newer" });
    storedKeyChanged(b.store, NAME, null);
    expect(b.store.getSnapshot().wallet).toBeNull();
    expect(loadChoice(storage)).toEqual({ kind: "walletconnect", topic: "newer" });
  });

  it("forgets the stored choice when it names this connection", async () => {
    const { storage, b } = await twoTabs();
    saveChoice(storage, { kind: "injected" });
    storedKeyChanged(b.store, NAME, null);
    expect(loadChoice(storage)).toBeNull();
  });

  it("treats a value this console would not use as a removal, never as a key", async () => {
    const { b } = await twoTabs();
    storedKeyChanged(b.store, NAME, "not json");
    expect(b.store.getSnapshot().wallet).toBeNull();
    expect(b.store.sessionKey).toBeNull();
  });

  it("does nothing to a tab that holds no key, another account's name, or a read-only tab", async () => {
    const storage = memoryStorage();
    const fresh = await tab(storage);
    await connectWallet(fresh.store, "injected");
    storedKeyChanged(fresh.store, NAME, null);
    expect(fresh.store.getSnapshot().wallet?.address).toBe(ACCOUNT); // no key here to end

    const { b } = await twoTabs();
    storedKeyChanged(b.store, sessionKeyName({ ...SCOPE, account: "0x0000000000000000000000000000000000000abc" }), null);
    storedKeyChanged(b.store, "monkeytrading.wallet-choice", null);
    expect(b.store.getSnapshot().wallet?.address).toBe(ACCOUNT);

    const watcher = await tab(storage);
    await connectWallet(watcher.store, "watch", true, { address: ACCOUNT, label: "Watching", readOnly: true, sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" });
    storedKeyChanged(watcher.store, NAME, null);
    expect(watcher.store.getSnapshot().wallet?.address).toBe(ACCOUNT);
  });
});

describe("a new key another tab registered", () => {
  it("is adopted with no signature, which finishes the popup's key step here", async () => {
    const storage = memoryStorage();
    const waiting = await tab(storage);
    await connectWallet(waiting.store, "injected");
    expect(waiting.store.getSnapshot().setup.open).toBe(true);
    const key = SessionKeySigner.generate();
    saveSessionKey(storage, SCOPE, key, NODE_TIME + 1000);
    storedKeyChanged(waiting.store, NAME, storage.getItem(NAME));
    expect(liveSessionKey(waiting.store)?.address).toBe(key.address);
    expect(waiting.store.getSnapshot().sessionExpiresAt).toBe(NODE_TIME + 1000);
    expect(signatures(waiting.provider)).toEqual([]);
  });

  it("replaces the key a tab holds, and is ignored when it is the one it holds", async () => {
    const { storage, b } = await twoTabs();
    const held = liveSessionKey(b.store);
    storedKeyChanged(b.store, NAME, storage.getItem(NAME));
    expect(liveSessionKey(b.store)).toBe(held); // the same key: not swapped for a copy
    const newer = SessionKeySigner.generate();
    saveSessionKey(storage, SCOPE, newer, NODE_TIME + 1000);
    storedKeyChanged(b.store, NAME, storage.getItem(NAME));
    expect(liveSessionKey(b.store)?.address).toBe(newer.address);
  });

  it("survives a late refusal of the key it replaced: only the dying key's entry is removed", async () => {
    const { storage, a } = await twoTabs();
    const newer = SessionKeySigner.generate();
    saveSessionKey(storage, SCOPE, newer, NODE_TIME + 1000); // another tab's key, not yet read here
    a.client.answer = () => { throw new EngineError(401, "session key revoked"); };
    await placeOrder(a.store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });
    expect(a.store.getSnapshot().wallet).toBeNull();
    expect(storage.held.has(NAME)).toBe(true);
    expect(JSON.parse(storage.held.get(NAME) ?? "{}")).toMatchObject({ address: newer.address });
  });
});

describe("a refusal of a key another tab has since replaced", () => {
  it("leaves the newer key and the connection alone, and says to try again", async () => {
    const { storage, a } = await twoTabs();
    const newer = SessionKeySigner.generate();
    let refuse!: () => void;
    a.client.answer = () => { throw new EngineError(401, "session key revoked"); };
    const place = a.client.placeOrder.bind(a.client);
    a.client.placeOrder = (body) => new Promise((resolve, reject) => { refuse = () => void place(body).then(resolve, reject); });
    const ordering = placeOrder(a.store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });
    await settle();
    saveSessionKey(storage, SCOPE, newer, NODE_TIME + 1000);
    storedKeyChanged(a.store, NAME, storage.getItem(NAME)); // the other tab's key arrives while the answer is on its way
    refuse();
    expect(await ordering).toBe(false);
    expect(a.store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    expect(liveSessionKey(a.store)?.address).toBe(newer.address);
    expect(JSON.parse(storage.held.get(NAME) ?? "{}")).toMatchObject({ address: newer.address });
    expect(a.store.getSnapshot().toasts.at(-1)?.text).toContain("Try again.");
  });
});

describe("the race for the shared key's nonce", () => {
  it("signs a cancel again with the nonce the node names, with no prompt, and only once", async () => {
    const { b } = await twoTabs();
    b.client.answer = (posted) => {
      if (posted.route === "cancel" && (posted.body as CancelRequest).auth?.nonce === 4) throw new EngineError(409, "invalid nonce", { kind: "invalid_nonce", expected: 5 });
      return new ActionClient().answer(posted);
    };
    await cancelOrder(b.store, 42);
    expect(b.client.posted.filter((p) => p.route === "cancel").map((p) => (p.body as CancelRequest).auth?.nonce)).toEqual([4, 5]);
    expect(signatures(b.provider)).toEqual([]);
    expect(b.store.getSnapshot().wallet?.address).toBe(ACCOUNT);
  });

  it("signs a cancel again when the refusal comes in the log, past admission, and an order never", async () => {
    const lost = { seq: 1, events: [{ type: "order_rejected" as const, account: ACCOUNT, client_id: 0, reason: { kind: "invalid_nonce" as const, expected: 5 } }] };
    const cancels = await twoTabs();
    cancels.b.client.answer = (posted) => ((posted.body as CancelRequest).auth?.nonce === 4 ? lost : new ActionClient().answer(posted));
    await cancelOrder(cancels.b.store, 42);
    expect(cancels.b.client.posted.filter((p) => p.route === "cancel").map((p) => (p.body as CancelRequest).auth?.nonce)).toEqual([4, 5]);
    const orders = await twoTabs();
    orders.b.client.answer = () => lost;
    await placeOrder(orders.b.store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });
    expect(orders.b.client.posted.filter((p) => p.route === "order")).toHaveLength(1);
    expect(orders.b.store.getSnapshot().toasts.at(-1)?.text).toBe("The request was out of order. Try again.");
  });

  it("reports an order and never sends it again, since a copy may have run, and stays connected", async () => {
    const { b } = await twoTabs();
    b.client.answer = () => { throw new EngineError(409, "invalid nonce", { kind: "invalid_nonce", expected: 5 }); };
    expect(await placeOrder(b.store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false })).toBe(false);
    expect(b.client.posted.filter((p) => p.route === "order")).toHaveLength(1);
    expect(b.store.getSnapshot().toasts.at(-1)?.text).toContain("had already used nonce 4");
    expect(b.store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    expect(liveSessionKey(b.store)).not.toBeNull();
  });
});
