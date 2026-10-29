/** Tests for the user's signed actions against a live client, with a test wallet over a fixed key. */

import { recoverTypedDataAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { EngineError, type ActionResult, type ClientEvent, type EngineClient } from "../engine/client";
import vectors from "../engine/eip712-vectors.json";
import { cancelTypedData, eligibilityTypedData, orderTypedData, requestDomain, withdrawalTypedData } from "../engine/eip712";
import { ProviderWallet } from "../engine/provider-wallet";
import { settle } from "../engine/test-kit";
import type { CancelRequest, EligibilityRequest, MarketView, OrderRequest, RequestAuth, StreamMessage, WithdrawalRequest } from "../engine/types";
import { ACCOUNT, StubProvider, type StubOptions } from "../engine/wallet-kit";
import type { Wallet } from "../engine/wallet";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { attestEligibility, cancelOrder, deposit, placeOrder, REQUEST_TTL_MS, withdraw } from "./actions";
import { ConsoleStore } from "./store";

const VAULT = vectors.vault;
const DOMAIN = requestDomain(vectors.chain_id, VAULT);
const BTC = { id: 1, symbol: "BTC-USD", open: true, reduce_only: false, mark: "100000", stress_level: 0, max_slippage_bps: 25, min_order_notional: "10", margin_tiers: [], spread_tiers: [], house_cap_bps: 0, schedule: { kind: "always_open" }, asset_class: "crypto" } as unknown as MarketView;
const NODE_TIME = 1_792_540_800_000;

type Posted = { route: string; body: OrderRequest | CancelRequest | WithdrawalRequest | EligibilityRequest };

/** A live client whose actions record what they were sent and answer as the test says. */
class ActionClient implements EngineClient {
  signatures = "checked" as const;
  deployment = { chainId: vectors.chain_id, vault: VAULT };
  posted: Posted[] = [];
  nonceReads = 0;
  answer: (posted: Posted) => ActionResult = () => ({ seq: 1, events: [] });
  async attestation(): Promise<never> { throw new Error("unused"); }
  async verify() { return { kind: "mock" } as const; }
  watch(listener: (event: ClientEvent) => void) { listener({ type: "feed", status: "live" }); return () => {}; }
  async markets() { return [BTC]; }
  async house() { return { cash: "0", nav: "0", gross_exposure: "0" }; }
  async account(): Promise<never> { throw new EngineError(404, "not found"); }
  async accessProbe() {}
  async nonce() { this.nonceReads++; return { next_nonce: 4, time_ms: NODE_TIME }; }
  async eligibility() { return { class: null, statement: null }; }
  private act(route: string, body: Posted["body"]) { const posted = { route, body }; this.posted.push(posted); return Promise.resolve().then(() => this.answer(posted)); }
  attestEligibility(body: EligibilityRequest) { return this.act("eligibility", body); }
  placeOrder(body: OrderRequest) { return this.act("order", body); }
  cancelOrder(body: CancelRequest) { return this.act("cancel", body); }
  withdraw(body: WithdrawalRequest) { return this.act("withdraw", body); }
  async reissue() {}
  async findWithdrawal() { return null; }
  quotes() {}
  async withdrawalQueue() { return { seq: 1, queue: [], next: null }; }
  async history() { return { events: [], next: null }; }
  subscribe(_: (message: StreamMessage) => void) { return () => {}; }
}

async function connected(options: StubOptions = {}) {
  const client = new ActionClient();
  const provider = new StubProvider(options);
  const wallet: Wallet = new ProviderWallet(ACCOUNT, "Test wallet", provider, { chainId: vectors.chain_id, vault: VAULT, usdc: "0x00000000000000000000000000000000000000cc", add: null }, { wait: async () => {} });
  const store = new ConsoleStore({ client, wallets: { options: [], connect: async () => wallet }, history: () => [], initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  store.start(0);
  await settle();
  store.liveWallet = wallet;
  store.setWallet({ address: ACCOUNT, label: "Test wallet" });
  return { client, provider, store };
}

/** The account that signed `auth` over `typed`. */
const signerOf = (typed: ReturnType<typeof orderTypedData>, auth: RequestAuth | undefined) =>
  recoverTypedDataAddress({ ...(typed as unknown as Parameters<typeof recoverTypedDataAddress>[0]), signature: (auth?.signature ?? "0x") as Hex }).then((a) => a.toLowerCase());

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
    expect(await signerOf(typed, order.auth)).toBe(ACCOUNT);
  });

  it("signs a cancel, a withdrawal and a declaration over exactly the body it posts", async () => {
    const { client, store } = await connected();
    await cancelOrder(store, 42);
    await withdraw(store, fixedFromInt(10));
    await attestEligibility(store, "eligible_client");
    const terms = { nonce: 4, expiresAt: NODE_TIME + REQUEST_TTL_MS };
    const [cancel, withdrawal, declaration] = client.posted.map((p) => p.body);
    expect(await signerOf(cancelTypedData(DOMAIN, cancel as CancelRequest, terms), cancel?.auth)).toBe(ACCOUNT);
    expect(await signerOf(withdrawalTypedData(DOMAIN, ACCOUNT, (withdrawal as WithdrawalRequest).amount, terms), withdrawal?.auth)).toBe(ACCOUNT);
    expect(declaration).toMatchObject({ account: ACCOUNT, class: "eligible_client" });
    expect(await signerOf(eligibilityTypedData(DOMAIN, ACCOUNT, "eligible_client", terms), declaration?.auth)).toBe(ACCOUNT);
  });

  it("signs once more with the nonce a 409 names, and only once", async () => {
    const { client, provider, store } = await connected();
    client.answer = () => { throw new EngineError(409, "invalid nonce", { kind: "invalid_nonce", expected: 9 }); };
    await cancelOrder(store, 42);
    expect(client.posted.map((p) => p.body.auth?.nonce)).toEqual([4, 9]);
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(2);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "error", text: "The request was out of order. Try again." });
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
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
