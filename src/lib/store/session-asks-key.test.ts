/** Tests for the key signature a declared wallet is asked for when an order needs one, now that it has no popup (monkey-trading/console#199). */

import { describe, expect, it } from "vitest";

import { settle } from "../engine/test-kit";
import { memoryStorage } from "../engine/wallet-kit";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { cancelOrder, connectWallet, placeOrder } from "./actions";
import { tab } from "./live-kit";
import { liveSessionKey } from "./session";
import type { ConsoleStore } from "./store";

const order = (store: ConsoleStore) => placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });
const typedSignatures = (provider: { calls: { method: string }[] }) => provider.calls.filter((c) => c.method === "eth_signTypedData_v4").length;

/** A declared wallet, reconnected as a page load does, so it holds no key. */
async function reconnected(options = {}) {
  const kit = await tab(memoryStorage(), options);
  kit.client.credited = true;
  await connectWallet(kit.store, "injected", true);
  return kit;
}

describe("a declared wallet with no key", () => {
  it("is asked for the key by the button that needs it, not sent to the popup, and is told to press again", async () => {
    const { client, provider, store } = await reconnected();
    expect(await order(store)).toBe(false);
    expect(typedSignatures(provider)).toBe(1);
    expect(liveSessionKey(store)).not.toBeNull();
    expect(store.getSnapshot().setup.open).toBe(false);
    expect(client.posted.map((p) => p.route)).toEqual(["session_key"]); // the order itself was not sent
    expect(store.getSnapshot().notices.ticket).toMatchObject({ tone: "info", text: "This browser can trade now. Send the request again." });
    expect(store.getSnapshot().busy).toBe(false);
  });

  it("trades silently once the key is there", async () => {
    const { client, provider, store } = await reconnected();
    await order(store);
    expect(await order(store)).toBe(true);
    expect(typedSignatures(provider)).toBe(1);
    expect(client.posted.map((p) => p.route)).toEqual(["session_key", "order"]);
  });

  it("asks again at the next press when the wallet declined, and each time", async () => {
    const { provider, store } = await reconnected({ fail: { eth_signTypedData_v4: { code: 4001, message: "User rejected" } } });
    await order(store);
    await cancelOrder(store, 1);
    expect(typedSignatures(provider)).toBe(2);
    expect(liveSessionKey(store)).toBeNull();
    expect(store.getSnapshot().setup.open).toBe(false);
    expect(store.getSnapshot().notices.ticket).toMatchObject({ tone: "error", text: "You declined to sign in your wallet." });
    expect(store.getSnapshot().notices.orders).toMatchObject({ tone: "error", text: "You declined to sign in your wallet." });
  });

  it("is sent through the wallet when the node refused its key, saying why, and is not asked for the key again", async () => {
    const { client, provider, store } = await reconnected();
    client.answer = () => ({ seq: 1, events: [{ type: "session_key_rejected", account: "0x0", session_key: "0x0", reason: { kind: "too_many_session_keys", max: 10 } }] });
    await order(store);
    expect(store.getSnapshot().sessionRefusal).toMatchObject({ kind: "too_many_session_keys" });
    const before = typedSignatures(provider);
    client.answer = (posted) => ({ seq: 2, events: posted.route === "order" ? [{ type: "order_rejected", account: "0x0", client_id: 1, reason: { kind: "invalid_signature" } }] : [] });
    await order(store);
    expect(typedSignatures(provider)).toBe(before + 1); // the order's own signature, through the wallet
    expect(client.posted.filter((p) => p.route === "session_key")).toHaveLength(1);
    expect(store.getSnapshot().notices.ticket).toMatchObject({ tone: "error" }); // the order is refused in the log; the ticket's refusal note says the wallet signs it
  });

  it("is never asked at a quiet reconnect, only by what needs the key", async () => {
    const { client, provider, store } = await reconnected();
    await settle();
    expect(typedSignatures(provider)).toBe(0);
    expect(client.posted).toEqual([]);
    expect(liveSessionKey(store)).toBeNull();
  });
});

describe("an undeclared wallet", () => {
  it("is sent to the popup by an order, and is not asked for a key before it has declared", async () => {
    const kit = await tab(memoryStorage());
    kit.client.declared = null;
    await connectWallet(kit.store, "injected", true);
    kit.store.patch({ setup: { ...kit.store.getSnapshot().setup, open: false } });
    expect(await order(kit.store)).toBe(false);
    expect(kit.store.getSnapshot().setup.open).toBe(true);
    expect(typedSignatures(kit.provider)).toBe(0);
  });
});
