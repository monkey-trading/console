/** Tests for the user's signed actions against a live client, with a test wallet over a fixed key. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { UntrustedError } from "../engine/trust";
import vectors from "../engine/eip712-vectors.json";
import { orderTypedData, registerSessionKeyTypedData, requestDomain } from "../engine/eip712";
import { SESSION_KEY_TTL_MS } from "../engine/session-key";
import type { CancelRequest, OrderRequest, SessionKeyRequest } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { loadChoice, type ChoiceStorage } from "../engine/wallet-persist";
import { fixedFromInt, fixedFromWire } from "../fixed";import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { cancelOrder, connectWallet, deposit, disconnectWallet, placeOrder, REQUEST_TTL_MS, withdraw } from "./actions";
import { connected, NODE_TIME, signerOf, VAULT, ActionClient, BTC } from "./live-kit";
import { loginSession } from "./session";
import { ConsoleStore } from "./store";

const DOMAIN = requestDomain(vectors.chain_id, VAULT);

/** A connected-wallet shape for connect tests that only count what the wallet was asked. */
const WALLET_STUB: Wallet = { address: ACCOUNT, label: "Test wallet", sign: async () => "0x", deposit: async () => "0x0", claim: async () => "0x0" };

/** The registration the login posted and the key it named, from a client that recorded one. */
function registrationOf(client: ActionClient, last = false): { request: SessionKeyRequest; sessionKey: string } {
  const posted = (last ? client.posted.filter((p) => p.route === "session_key").at(-1) : undefined) ?? client.posted.find((p) => p.route === "session_key");
  if (!posted) throw new Error("no session-key registration posted");
  const request = posted.body as SessionKeyRequest;
  return { request, sessionKey: request.session_key.toLowerCase() };
}

describe("signed actions with a fixed-key wallet", () => {
  it("logs in with the one wallet signature, then signs the order with the session key — no second wallet prompt", async () => {
    const { client, provider, store } = await connected();
    await placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });
    const { request, sessionKey } = registrationOf(client);
    // The registration is the account's signature: the one wallet prompt of the whole flow.
    expect(request).toMatchObject({ account: ACCOUNT, expires_at: NODE_TIME + SESSION_KEY_TTL_MS, auth: { nonce: 4, expires_at: NODE_TIME + REQUEST_TTL_MS } });
    const registerTyped = registerSessionKeyTypedData(DOMAIN, request.account, request.session_key, request.expires_at, { nonce: request.auth.nonce, expiresAt: request.auth.expires_at });
    expect(await signerOf(registerTyped, request.auth.signature)).toBe(ACCOUNT);
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(1);
    // The order is byte-identical to an account-signed one but for the signer: the session key.
    const order = client.posted.at(-1);
    if (!order || order.route !== "order") throw new Error("no order posted");
    const body = order.body as OrderRequest;
    expect(body).toMatchObject({ account: ACCOUNT, market: 1, side: "buy", qty: "0.5", kind: { kind: "market", quoted: "100000", max_slippage_bps: 10 }, reduce_only: false, auth: { nonce: 4, expires_at: NODE_TIME + REQUEST_TTL_MS } });
    expect(REQUEST_TTL_MS).toBeLessThanOrEqual(5 * 60_000);
    const typed = orderTypedData(DOMAIN, body, { nonce: 4, expiresAt: NODE_TIME + REQUEST_TTL_MS });
    expect(await signerOf(typed, body.auth?.signature)).toBe(sessionKey);
  });

  it("re-runs the login once when the node says the session key expired, and retries the order silently", async () => {
    const { client, provider, store } = await connected();
    await loginSession(store); // the connect-time login
    let expiredOnce = true;
    client.answer = (posted) => {
      if (posted.route === "order" && expiredOnce) {
        expiredOnce = false;
        throw new EngineError(401, "session key expired", { kind: "invalid_signature" });
      }
      if (posted.route === "session_key") {
        const body = posted.body as SessionKeyRequest;
        return { seq: 1, events: [{ type: "session_key_registered", account: body.account, session_key: body.session_key, expires_at: body.expires_at }] };
      }
      return { seq: 1, events: [] };
    };
    await placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });
    // Two registrations (connect-time and the retry), two orders (refused, then retried)...
    expect(client.posted.filter((p) => p.route === "session_key")).toHaveLength(2);
    expect(client.posted.filter((p) => p.route === "order")).toHaveLength(2);
    // ...and exactly one more wallet signature than the connect-time login spent.
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(2);
    const second = client.posted.at(-1);
    if (!second || second.route !== "order") throw new Error("no retried order posted");
    const retried = registrationOf(client, true);
    const typed = orderTypedData(DOMAIN, second.body as OrderRequest, { nonce: (second.body as OrderRequest).auth?.nonce ?? 0, expiresAt: ((second.body as OrderRequest).auth?.expires_at ?? 0) });
    expect(await signerOf(typed, (second.body as OrderRequest).auth?.signature)).toBe(retried.sessionKey);
  });

  it("re-signs the registration once more with the nonce a 409 names, and only once", async () => {
    const { client, provider, store } = await connected();
    client.answer = () => { throw new EngineError(409, "invalid nonce", { kind: "invalid_nonce", expected: 9 }); };
    await loginSession(store);
    expect(client.posted.map((p) => ("auth" in p.body ? p.body.auth?.nonce : undefined))).toEqual([4, 9]);
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(2);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "error", text: "The request was out of order. Try again." });
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
  });

  it("re-signs a session-signed cancel with the nonce a 409 names, silently, and only once", async () => {
    const { client, provider, store } = await connected();
    await loginSession(store);
    client.answer = (posted) => {
      if (posted.route === "cancel") throw new EngineError(409, "invalid nonce", { kind: "invalid_nonce", expected: 9 });
      return new ActionClient().answer(posted);
    };
    await cancelOrder(store, 42);
    expect(client.posted.filter((p) => p.route === "cancel").map((p) => (p.body as CancelRequest).auth?.nonce)).toEqual([4, 9]);
    // No wallet signature beyond the connect-time login's: the retry is the key's.
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(1);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "error", text: "The request was out of order. Try again." });
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
  });
  it("does not sign an order or a withdrawal again after a 409, since a copy may have run, and reads the account before saying so", async () => {
    // The wallet-signed withdrawal posts alone; the order's on-demand login registers first, then the order refuses once.
    for (const [route, run] of [
      ["withdraw", (store: Parameters<typeof withdraw>[0]) => withdraw(store, fixedFromInt(10))],
      ["order", (store: Parameters<typeof withdraw>[0]) => placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false })],
    ] as const) {
      const { client, provider, store } = await connected();
      await loginSession(store); // the connect-time login, so the 409 below is the action's own
      client.answer = () => { throw new EngineError(409, "invalid nonce", { kind: "invalid_nonce", expected: 9 }); };
      const reads = client.marketReads;
      await run(store);
      expect(client.posted.filter((p) => p.route === route).map((p) => ("auth" in p.body ? p.body.auth?.nonce : undefined))).toEqual([4]);
      // The login spent one wallet signature; only the withdrawal asks for another.
      expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(route === "withdraw" ? 2 : 1);
      expect(client.marketReads).toBeGreaterThan(reads);
      expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The node had already used nonce 4 for this account, so it did not take this request as sent. If it was sent twice it may have run: check your positions, orders, withdrawals and history before trying again.");
    }
  });

  it("reads the account again and says a sent request may have run when the node does not answer", async () => {
    const { client, store } = await connected();
    await loginSession(store); // the connect-time login, so the failure below is the cancel's own
    client.answer = (posted) => {
      if (posted.route === "cancel") throw new EngineError(0, "The node did not answer.");
      return new ActionClient().answer(posted);
    };
    const reads = client.marketReads;
    await cancelOrder(store, 42);
    expect(client.marketReads).toBeGreaterThan(reads);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The node did not answer. It may have run: check your positions, orders, withdrawals and history before trying again.");
  });

  it("reads the account and says a sent request may have run when its answer does not verify, but not for a failure before sending", async () => {
    const { client, store } = await connected();
    client.answer = () => { throw new UntrustedError("The node's answer (HTTP 200) was not signed by the attested enclave, so it was discarded."); };
    const reads = client.marketReads;
    await withdraw(store, fixedFromInt(10));
    expect(client.marketReads).toBeGreaterThan(reads);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The node's answer (HTTP 200) was not signed by the attested enclave, so it was discarded. It may have run: check your positions, orders, withdrawals and history before trying again.");
    const before = client.marketReads;
    client.nonce = async () => { throw new UntrustedError("The node is not verified."); };
    await withdraw(store, fixedFromInt(10));
    expect(client.marketReads).toBe(before);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The node is not verified.");
  });

  it("asks the wallet for the one login signature when trading needs it, then signs cancels silently", async () => {
    const { store } = await connected();
    const prompts: (string | null)[] = [];
    store.subscribe(() => prompts.push(store.getSnapshot().prompt));
    await cancelOrder(store, 42); // no key yet: this runs the login
    const shown = prompts.filter((p) => p !== null);
    expect(shown.some((p) => p.startsWith("Confirm in your wallet: authorize this browser to trade until"))).toBe(true);
    expect(shown).toHaveLength(1);
    expect(store.getSnapshot().prompt).toBeNull();
    await cancelOrder(store, 43); // the key is live: no wallet prompt at all
    expect(prompts.filter((p) => p !== null)).toHaveLength(1);
  });

  it("signs nothing and reads no nonce for a node whose attestation is not accepted", async () => {
    const { client, provider, store } = await connected();
    store.patch({ attestation: { kind: "unverified", reason: "no" } });
    await cancelOrder(store, 42);
    await deposit(store, fixedFromInt(10));
    expect(client.nonceReads).toBe(0);
    expect(provider.calls).toEqual([]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The console will not send a deposit: the node's attestation is not verified.");
  });

  it("tells the user when they decline in the wallet, and posts nothing", async () => {
    const { client, store } = await connected({ fail: { eth_signTypedData_v4: { code: 4001, message: "User rejected" } } });
    await withdraw(store, fixedFromInt(10));
    expect(client.posted).toEqual([]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("You declined to sign in your wallet.");
  });
});

describe("a wallet change", () => {
  it("clears everything read or streamed for the old account, and ends the old wallet's session, on disconnect or another connect", async () => {
    const { store, wallet } = await connected();
    let ended = 0;
    wallet.disconnect = async () => void (ended += 1);
    const filled = { quotes: { 1: { type: "quote" } }, quoteError: "x", quoted: [1], authorizations: [{ nonce: 1 }], approvals: [{ type: "withdrawal_approved" }], paid: [1], queue: [{ position: 1 }], history: [{ type: "fill" }] } as unknown as Partial<ReturnType<typeof store.getSnapshot>>;
    const cleared = { account: null, eligibility: null, queue: [], history: [], quotes: {}, quoteError: null, quoted: [], authorizations: [], approvals: [], paid: [] };
    store.patch(filled);
    disconnectWallet(store);
    expect(store.getSnapshot()).toMatchObject({ wallet: null, ...cleared });
    expect(ended).toBe(1);
    store.liveWallet = wallet;
    store.patch(filled);
    // Another wallet, such as a browser wallet after a WalletConnect one; only its address and label are read.
    store.deps.wallets.connect = async () => ({ address: "0x00000000000000000000000000000000000000aa", label: "Other" }) as Wallet;
    await connectWallet(store, "other");
    expect(ended).toBe(2);
    expect(store.getSnapshot()).toMatchObject({ quotes: {}, quoted: [], authorizations: [], approvals: [], paid: [] });
  });

  it("tells the user when the old wallet's session does not close", async () => {
    const { store, wallet } = await connected();
    wallet.disconnect = async () => { throw new Error("offline"); };
    disconnectWallet(store);
    await settle();
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The wallet's session did not close: offline");
  });

  it("offers to add the deployment's USDC once connected, toasting only when the wallet adds it", async () => {
    const stub = (suggestUsdc: () => Promise<boolean>): Wallet => ({ address: ACCOUNT, label: "Test wallet", suggestUsdc, sign: async () => "0x", deposit: async () => "0x0", claim: async () => "0x0" });
    const offering = (suggestUsdc: () => Promise<boolean>) =>
      new ConsoleStore({
        client: new ActionClient(), wallets: { options: [], connect: async () => stub(suggestUsdc) }, history: () => [],
        initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 },
      });
    const store = offering(async (): Promise<boolean> => true);
    await connectWallet(store, "browser");
    await settle();
    expect(store.getSnapshot().toasts).toContainEqual({ id: expect.any(Number), tone: "info", text: "USDC was added to your wallet, so its balance shows there." });
    const declined = offering(async (): Promise<boolean> => false);
    await connectWallet(declined, "browser");
    await settle();
    expect(declined.getSnapshot().toasts.some((t) => t.text.includes("USDC"))).toBe(false);
  });

  it("persists the injected connector choice when the session has storage, and no other choice", async () => {
    const held = new Map<string, string>();
    const persistence: ChoiceStorage = {
      getItem: (key) => held.get(key) ?? null,
      setItem: (key, value) => void held.set(key, value),
      removeItem: (key) => void held.delete(key),
    };
    const { store } = await connected();
    store.deps.persistence = persistence;
    expect(await connectWallet(store, "injected", true)).toBe(true);
    expect(loadChoice(persistence)).toEqual({ kind: "injected" });
    // A read-only watch account is not a connection the console persists.
    held.clear();
    expect(await connectWallet(store, "watch", true)).toBe(true);
    expect(loadChoice(persistence)).toBeNull();
  });

  it("offers USDC only on a connect the visitor started, not a quiet reconnect", async () => {
    const offered: boolean[] = [];
    const { store } = await connected();
    store.deps.wallets.connect = async () => ({ ...WALLET_STUB, suggestUsdc: async () => { offered.push(true); return false; } });
    await connectWallet(store, "injected", true); // a stored choice's reconnect: quiet
    await connectWallet(store, "injected"); // the visitor picking the wallet: not quiet
    expect(offered).toEqual([true]);
  });

  it("adopts an already-established wallet without asking the connector, and reports failure as false", async () => {
    const { store, wallet } = await connected();
    let asked = 0;
    store.deps.wallets.connect = async () => { asked += 1; throw new Error("must not be asked"); };
    expect(await connectWallet(store, "walletconnect", true, wallet)).toBe(true);
    expect(asked).toBe(0);
    store.deps.wallets.connect = async () => { throw new Error("offline"); };
    expect(await connectWallet(store, "walletconnect", true)).toBe(false);
  });

  it("a quiet connect never replaces a wallet that connected while it waited, and persists nothing for the refused one", async () => {
    const { store } = await connected();
    disconnectWallet(store); // no wallet connected when the quiet reconnect left its request pending
    const held = new Map<string, string>();
    const persistence: ChoiceStorage = {
      getItem: (key) => held.get(key) ?? null,
      setItem: (key, value) => void held.set(key, value),
      removeItem: (key) => void held.delete(key),
    };
    store.deps.persistence = persistence;
    const newer: Wallet = { address: "0x00000000000000000000000000000000000000bb", label: "Newer", sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" };
    let released = 0;
    // The approved WalletConnect session a quiet reconnect left pending: its topic must not persist, its session ends.
    const stale: Wallet = { ...WALLET_STUB, topic: "stale-topic", disconnect: async () => { released += 1; } };
    store.liveWallet = newer;
    store.setWallet({ address: newer.address, label: newer.label });
    store.deps.wallets.connect = async () => stale;
    expect(await connectWallet(store, "walletconnect", true)).toBe(false);
    expect(store.liveWallet).toBe(newer); // the newer wallet stays
    expect(store.getSnapshot().wallet?.address).toBe(newer.address); // the stale connect adopted nothing
    expect(released).toBe(1); // its session was ended
    expect(held.size).toBe(0); // and its topic was not persisted over the newer connection
    // A connect the visitor started is not quiet and still replaces, adopting its topic as the choice.
    store.liveWallet = null;
    store.deps.wallets.connect = async () => newer;
    expect(await connectWallet(store, "injected")).toBe(true);
    expect(store.liveWallet).toBe(newer);
    expect(loadChoice(persistence)).toEqual({ kind: "injected" });
  });
});
