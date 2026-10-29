/** Tests only: a live client whose actions and reads answer as a test says, and a store connected to it through a fixed-key wallet. */

import { recoverTypedDataAddress, type Hex } from "viem";

import { EngineError, type ActionResult, type ClientEvent, type EngineClient } from "../engine/client";
import vectors from "../engine/eip712-vectors.json";
import type { TypedRequest } from "../engine/eip712";
import type { QuoteRequest } from "../engine/live-stream";
import { ProviderWallet } from "../engine/provider-wallet";
import { settle } from "../engine/test-kit";
import type { CancelRequest, EligibilityRequest, HistoryPage, MarketView, OrderRequest, SignedWithdrawal, WithdrawalRequest } from "../engine/types";
import { ACCOUNT, StubProvider, type StubOptions } from "../engine/wallet-kit";
import type { Wallet } from "../engine/wallet";
import { ConsoleStore } from "./store";

export const VAULT = vectors.vault;
export const BTC = { id: 1, symbol: "BTC-USD", open: true, reduce_only: false, mark: "100000", stress_level: 0, max_slippage_bps: 25, min_order_notional: "10", margin_tiers: [], spread_tiers: [], house_cap_bps: 0, schedule: { kind: "always_open" }, asset_class: "crypto" } as unknown as MarketView;
export const NODE_TIME = 1_792_540_800_000;

export type Posted = { route: string; body: OrderRequest | CancelRequest | WithdrawalRequest | EligibilityRequest | { replaces_expires_at: number; signature: string } };

/** A live client whose actions record what they were sent and answer as the test says. */
export class ActionClient implements EngineClient {
  signatures = "checked" as const;
  deployment = { chainId: vectors.chain_id, vault: VAULT };
  posted: Posted[] = [];
  nonceReads = 0;
  marketReads = 0;
  quoteRequests: (QuoteRequest | null)[] = [];
  historyReads: { kind?: string | undefined }[] = [];
  historyPage: HistoryPage = { events: [], next: null };
  /** Pages by `before` cursor, when a test needs more than one; `historyPage` answers otherwise. */
  historyPages: Record<string, HistoryPage> | null = null;
  found: SignedWithdrawal | null = null;
  answer: (posted: Posted) => ActionResult = () => ({ seq: 1, events: [] });
  async attestation(): Promise<never> { throw new Error("unused"); }
  async verify() { return { kind: "mock" } as const; }
  watch(listener: (event: ClientEvent) => void) { listener({ type: "feed", status: "live" }); return () => {}; }
  async markets() { this.marketReads++; return [BTC]; }
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
  async reissue(_account: string, nonce: number, body: { replaces_expires_at: number; signature: string }) { await this.act(`reissue ${nonce}`, body); }
  async findWithdrawal() { return this.found; }
  quotes(request: QuoteRequest | null) { this.quoteRequests.push(request); }
  async withdrawalQueue() { return { seq: 1, queue: [], next: null }; }
  async history(_address: string, params: { kind?: string; before?: string }) {
    this.historyReads.push({ kind: params.kind });
    return this.historyPages?.[params.before ?? ""] ?? this.historyPage;
  }
  subscribe() { return () => {}; }
}

/** A started store over an `ActionClient`, connected to a wallet over a stub provider with Anvil's account 0. */
export async function connected(options: StubOptions = {}) {
  const client = new ActionClient();
  const provider = new StubProvider(options);
  const wallet: Wallet = new ProviderWallet(ACCOUNT, "Test wallet", provider, { chainId: vectors.chain_id, vault: VAULT, usdc: "0x00000000000000000000000000000000000000cc", add: null }, { wait: async () => {} });
  const store = new ConsoleStore({ client, wallets: { options: [], connect: async () => wallet }, history: () => [], initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  store.start(0);
  await settle();
  store.liveWallet = wallet;
  store.setWallet({ address: ACCOUNT, label: "Test wallet" });
  return { client, provider, store, wallet };
}

/** The account that signed `signature` over `typed`, lowercased. */
export const signerOf = (typed: TypedRequest, signature: string | undefined) =>
  // The typed data is viem's shape: domain, types, primaryType and message.
  recoverTypedDataAddress({ ...(typed as unknown as Parameters<typeof recoverTypedDataAddress>[0]), signature: (signature ?? "0x") as Hex }).then((a) => a.toLowerCase());
