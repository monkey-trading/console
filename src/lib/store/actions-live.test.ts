/** Tests for the user's signed actions against a live client, with a test wallet over a fixed key. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { UntrustedError } from "../engine/trust";
import vectors from "../engine/eip712-vectors.json";
import { cancelTypedData, eligibilityTypedData, orderTypedData, requestDomain, withdrawalTypedData } from "../engine/eip712";
import type { CancelRequest, EligibilityRequest, OrderRequest, WithdrawalRequest } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { loadChoice, type ChoiceStorage } from "../engine/wallet-persist";
import { fixedFromInt, fixedFromWire } from "../fixed";import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { attestEligibility, cancelOrder, connectWallet, deposit, disconnectWallet, placeOrder, REQUEST_TTL_MS, withdraw } from "./actions";
import { connected, NODE_TIME, signerOf, VAULT, ActionClient, BTC } from "./live-kit";
import { ConsoleStore } from "./store";

const DOMAIN = requestDomain(vectors.chain_id, VAULT);

/** A connected-wallet shape for connect tests that only count what the wallet was asked. */
const WALLET_STUB: Wallet = { address: ACCOUNT, label: "Test wallet", sign: async () => "0x", deposit: async () => "0x0", claim: async () => "0x0" };

describe("signed actions with a fixed-key wallet", () => {
  it("signs an order with the node's nonce and an expiry two minutes past its signed time, carrying the price shown and the bound", async () => {
    const { client, store } = await connected();
    await placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });
    const posted = client.posted[0];
    if (!posted || posted.route !== "order") throw new Error("no order posted");
    const order = posted.body as OrderRequest;
    expect(order).toMatchObject({ account: ACCOUNT, market: 1, side: "buy", qty: "0.5", kind: { kind: "market", quoted: "100000", max_slippage_bps: 10 }, reduce_only: false, auth: { nonce: 4, expires_at: NODE_TIME + REQUEST_TTL_MS } });
    expect(REQUEST_TTL_MS).toBeLessThanOrEqual(5 * 60_000);
    const typed = orderTypedData(DOMAIN, order, { nonce: 4, expiresAt: NODE_TIME + REQUEST_TTL_MS });
    expect(await signerOf(typed, order.auth?.signature)).toBe(ACCOUNT);
  });

  it("signs a cancel, a withdrawal and a declaration over exactly the body it posts", async () => {
    const { client, store } = await connected();
    await cancelOrder(store, 42);
    await withdraw(store, fixedFromInt(10));
    await attestEligibility(store, "eligible_client");
    const terms = { nonce: 4, expiresAt: NODE_TIME + REQUEST_TTL_MS };
    // The three actions post these request types, in this order.
    const [cancel, withdrawal, declaration] = client.posted.map((p) => p.body) as [CancelRequest, WithdrawalRequest, EligibilityRequest];
    expect(await signerOf(cancelTypedData(DOMAIN, cancel, terms), cancel.auth?.signature)).toBe(ACCOUNT);
    expect(await signerOf(withdrawalTypedData(DOMAIN, ACCOUNT, withdrawal.amount, terms), withdrawal.auth?.signature)).toBe(ACCOUNT);
    expect(declaration).toMatchObject({ account: ACCOUNT, class: "eligible_client" });
    expect(await signerOf(eligibilityTypedData(DOMAIN, ACCOUNT, "eligible_client", terms), declaration.auth.signature)).toBe(ACCOUNT);
  });

  it("signs a cancel once more with the nonce a 409 names, and only once", async () => {
    const { client, provider, store } = await connected();
    client.answer = () => { throw new EngineError(409, "invalid nonce", { kind: "invalid_nonce", expected: 9 }); };
    await cancelOrder(store, 42);
    expect(client.posted.map((p) => ("auth" in p.body ? p.body.auth?.nonce : undefined))).toEqual([4, 9]);
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(2);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "error", text: "The request was out of order. Try again." });
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
  });

  it("does not sign an order or a withdrawal again after a 409, since a copy may have run, and reads the account before saying so", async () => {
    for (const run of [
      (store: Parameters<typeof withdraw>[0]) => withdraw(store, fixedFromInt(10)),
      (store: Parameters<typeof withdraw>[0]) => placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false }),
    ]) {
      const { client, provider, store } = await connected();
      client.answer = () => { throw new EngineError(409, "invalid nonce", { kind: "invalid_nonce", expected: 9 }); };
      const reads = client.marketReads;
      await run(store);
      expect(client.posted.map((p) => ("auth" in p.body ? p.body.auth?.nonce : undefined))).toEqual([4]);
      expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(1);
      expect(client.marketReads).toBeGreaterThan(reads);
      expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The node had already used nonce 4 for this account, so it did not take this request as sent. If it was sent twice it may have run: check your positions, orders, withdrawals and history before trying again.");
    }
  });

  it("reads the account again and says a sent request may have run when the node does not answer", async () => {
    const { client, store } = await connected();
    client.answer = () => { throw new EngineError(0, "The node did not answer."); };
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

  it("shows what the wallet is asked to sign while it waits, and clears it after", async () => {
    const { store } = await connected();
    const prompts: (string | null)[] = [];
    store.subscribe(() => prompts.push(store.getSnapshot().prompt));
    await cancelOrder(store, 42);
    expect(prompts.filter((p) => p !== null)).toContain("Confirm in your wallet: cancel order 42.");
    expect(store.getSnapshot().prompt).toBeNull();
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

  it("a quiet connect never replaces a wallet that connected while it waited", async () => {
    const { store } = await connected();
    disconnectWallet(store); // no wallet connected when the quiet reconnect left its request pending
    const newer: Wallet = { address: "0x00000000000000000000000000000000000000bb", label: "Newer", sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" };
    let released = 0;
    const stale: Wallet = { ...WALLET_STUB, disconnect: async () => { released += 1; } };
    store.liveWallet = newer;
    store.setWallet({ address: newer.address, label: newer.label });
    store.deps.wallets.connect = async () => stale; // the approved request a quiet reconnect left pending
    expect(await connectWallet(store, "injected", true)).toBe(false);
    expect(store.liveWallet).toBe(newer); // the newer wallet stays
    expect(store.getSnapshot().wallet?.address).toBe(newer.address); // the stale connect adopted nothing
    expect(released).toBe(1); // its session was ended
    // A connect the visitor started is not quiet and still replaces.
    store.liveWallet = null;
    store.deps.wallets.connect = async () => newer;
    expect(await connectWallet(store, "injected")).toBe(true);
    expect(store.liveWallet).toBe(newer);
  });
});
