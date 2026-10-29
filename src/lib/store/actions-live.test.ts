/** Tests for the user's signed actions against a live client, with a test wallet over a fixed key. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import vectors from "../engine/eip712-vectors.json";
import { cancelTypedData, eligibilityTypedData, orderTypedData, requestDomain, withdrawalTypedData } from "../engine/eip712";
import type { CancelRequest, EligibilityRequest, OrderRequest, WithdrawalRequest } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { attestEligibility, cancelOrder, deposit, placeOrder, REQUEST_TTL_MS, withdraw } from "./actions";
import { connected, NODE_TIME, signerOf, VAULT } from "./live-kit";

const DOMAIN = requestDomain(vectors.chain_id, VAULT);

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

  it("reads the account again before showing any refusal of a request, which may have run from a copy", async () => {
    const { client, store } = await connected();
    client.answer = () => { throw new EngineError(0, "The node did not answer."); };
    const reads = client.marketReads;
    await cancelOrder(store, 42);
    expect(client.marketReads).toBeGreaterThan(reads);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The node did not answer.");
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
