/** Tests only: a live client whose actions and reads answer as a test says, and a store connected to it through a fixed-key wallet. */

import { recoverTypedDataAddress, type Hex } from "viem";

import { EngineError, type ActionResult, type ClientEvent, type EngineClient } from "../engine/client";
import vectors from "../engine/eip712-vectors.json";
import type { EntitlementProof } from "../engine/emissions";
import type { TypedRequest } from "../engine/eip712";
import type { QuoteRequest } from "../engine/live-stream";
import { ProviderWallet } from "../engine/provider-wallet";
import type { KeyStorage } from "../engine/session-key-store";
import { settle } from "../engine/test-kit";
import type { AccountView, CancelAllRequest, CancelRequest, CloseAllRequest, EligibilityClass, EligibilityRequest, HistoryPage, OrderRequest, PayoutsPage, SessionKeyRequest, SessionKeyRevocationRequest, SignedWithdrawal, StreamMessage, WithdrawalRequest, MarketView } from "../engine/types";
import type { MarkPage } from "../engine/mark-types";
import { ACCOUNT, memoryStorage, StubProvider, type StubOptions } from "../engine/wallet-kit";
import type { Wallet } from "../engine/wallet";
import { saveChoice } from "../engine/wallet-persist";
import { authorizeBrowser, connectWallet } from "./actions";
import { loginSession } from "./session";
import { ConsoleStore } from "./store";

export const VAULT = vectors.vault;
export const BTC = { id: 1, symbol: "BTC-USD", open: true, reduce_only: false, mark: "100000", stress_level: 0, max_slippage_bps: 25, min_order_notional: "10", margin_tiers: [], spread_tiers: [], house_cap_bps: 0, schedule: { kind: "always_open" }, asset_class: "crypto" } as unknown as MarketView;
export const NODE_TIME = 1_792_540_800_000;

export type Posted = { route: string; body: OrderRequest | CancelRequest | CancelAllRequest | CloseAllRequest | WithdrawalRequest | EligibilityRequest | SessionKeyRequest | SessionKeyRevocationRequest | { replaces_expires_at: number; signature: string } };

/** A live client whose actions record what they were sent and answer as the test says. */
export class ActionClient implements EngineClient {
  signatures = "checked" as const;
  deployment = { chainId: vectors.chain_id, vault: VAULT };
  /** The log head signed reads answer at; a test may set it, as the node's answers do. */
  headSeq: number | null = null;
  posted: Posted[] = [];
  nonceReads = 0;
  marketReads = 0;
  quoteRequests: (QuoteRequest | null)[] = [];
  historyReads: { kind?: string | undefined }[] = [];
  historyPage: HistoryPage = { events: [], next: null };
  /** Pages by `before` cursor, when a test needs more than one; `historyPage` answers otherwise. */
  historyPages: Record<string, HistoryPage> | null = null;
  /** Pages of the node's payouts by `after` cursor, when a test needs more than one; `payoutsPage` answers otherwise. */
  payoutsPages: Record<string, PayoutsPage> | null = null;
  payoutsPage: PayoutsPage = { seq: 100, loaded: true, payouts: [], next: null };
  payoutsReads: { limit: number; after?: number | undefined }[] = [];
  /** Set to make every payouts read fail with it. */
  payoutsError: Error | null = null;
  found: SignedWithdrawal | null = null;
  answer: (posted: Posted) => ActionResult = (posted) =>
    posted.route === "session_key"
      ? { seq: 1, events: [{ type: "session_key_registered", account: (posted.body as SessionKeyRequest).account, session_key: (posted.body as SessionKeyRequest).session_key, expires_at: (posted.body as SessionKeyRequest).expires_at }] }
      : { seq: 1, events: [] };
  async attestation(): Promise<never> { throw new Error("unused"); }
  async verify() { return { kind: "mock" } as const; }
  /** The store's client-event listener, for a test to report an event as the client would. */
  listener: ((event: ClientEvent) => void) | null = null;
  watch(listener: (event: ClientEvent) => void) { this.listener = listener; listener({ type: "feed", status: "live" }); return () => {}; }
  async markets() { this.marketReads++; return [BTC]; }
  async house() { return { cash: "0", nav: "0", gross_exposure: "0" }; }
  async houseState() { return { seq: null, params: null, checkpoint: null, listingNotices: {}, governance: null }; }
  async withdrawalTotals() { return { count: 0, remaining: 0n, largest: null, head: null, seq: null, complete: true, stable: true }; }
  private absent = async (): Promise<never> => { throw new EngineError(404, "not found"); };
  readonly stats = { positions: this.absent, series: this.absent, monkey: this.absent, activity: this.absent, distributions: async () => null, operator: this.absent, operators: this.absent, distributionEpochs: this.absent };
  /** The chain reads each connection handed over, oldest first. */
  chainsRead: unknown[] = [];
  async readChainThrough(chain: unknown) { this.chainsRead.push(chain); }
  async heedVault() {}
  /** Whether the account read answers as a credited account; false answers the node's 404. */
  credited = false;
  /** What the credited account holds; a test sets it and reads the account again. */
  orders: AccountView["orders"] = {};
  async account(): Promise<AccountView> {
    if (!this.credited) throw new EngineError(404, "not found");
    return { balance: "1000", equity: "1000", margin: "0", positions: {}, orders: this.orders, toxicity_bps: 0 };
  }
  async accessProbe() {}
  async nonce() { this.nonceReads++; return { next_nonce: 4, time_ms: NODE_TIME }; }
  /** The account's recorded declaration; a test may clear it. */
  declared: EligibilityClass | null = "professional";
  async eligibility() { return { class: this.declared, statement: null }; }
  /** The account's entitlement proof; a test may set it. */
  entitlement: EntitlementProof | null = null;
  async emissions() { return this.entitlement; }
  async exitProof() { return null; }
  private act(route: string, body: Posted["body"]) { const posted = { route, body }; this.posted.push(posted); return Promise.resolve().then(() => this.answer(posted)); }
  attestEligibility(body: EligibilityRequest) { return this.act("eligibility", body); }
  placeOrder(body: OrderRequest) { return this.act("order", body); }
  cancelOrder(body: CancelRequest) { return this.act("cancel", body); }
  cancelAll(body: CancelAllRequest) { return this.act("cancel_all", body); }
  closeAll(body: CloseAllRequest) { return this.act("close_all", body); }
  withdraw(body: WithdrawalRequest) { return this.act("withdraw", body); }
  registerSessionKey(body: SessionKeyRequest) { return this.act("session_key", body); }
  revokeSessionKey(body: SessionKeyRevocationRequest) { return this.act("session_key_revoke", body); }
  async reissue(_account: string, nonce: number, body: { replaces_expires_at: number; signature: string }) { await this.act(`reissue ${nonce}`, body); }
  async payouts(_account: string, page: { limit: number; after?: number }) {
    this.payoutsReads.push(page);
    if (this.payoutsError !== null) throw this.payoutsError;
    return this.payoutsPages?.[String(page.after ?? "")] ?? this.payoutsPage;
  }
  async scanMarks() { return []; }
  /** The page every marks read answers; a test replaces it. */
  marksPage: MarkPage = { entries: [], next: null };
  marksReads: number[] = [];
  async marks(market: number) { this.marksReads.push(market); return this.marksPage; }
  quotes(request: QuoteRequest | null) { this.quoteRequests.push(request); }
  async emissionSchedule() { return null; }
  async withdrawalQueue() { return { seq: 77, queue: [], next: null }; }
  async history(_address: string, params: { kind?: string; before?: string }) {
    this.historyReads.push({ kind: params.kind });
    return this.historyPages?.[params.before ?? ""] ?? this.historyPage;
  }
  private subscribers = new Set<(message: StreamMessage) => void>();
  subscribe(onMessage: (message: StreamMessage) => void) { this.subscribers.add(onMessage); return () => { this.subscribers.delete(onMessage); }; }
  /** Delivers one stream message to every subscriber, as the node would. */
  deliver(message: StreamMessage) { for (const subscriber of this.subscribers) subscriber(message); }
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

/** A started store with storage, as a tab of a live build opens, whose connector answers the fixed-key wallet; give two the one storage for two tabs. */
export async function tab(persistence: KeyStorage, options: StubOptions = {}) {
  const client = new ActionClient();
  const provider = new StubProvider(options);
  const wallet: Wallet = new ProviderWallet(ACCOUNT, "Browser wallet", provider, { chainId: vectors.chain_id, vault: VAULT, usdc: null, add: null }, { wait: async () => {} });
  const store = new ConsoleStore({ client, wallets: { options: [], connect: async () => wallet }, persistence, history: () => [], initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  store.start(0);
  await settle();
  return { client, provider, store, wallet };
}

/** A tab connected on `storage` and authorized, as setup leaves it, its account credited. */
export async function authorizedTab(storage = memoryStorage()) {
  const kit = await tab(storage);
  kit.client.credited = true;
  await connectWallet(kit.store, "injected");
  await authorizeBrowser(kit.store, "setup");
  return { ...kit, storage };
}

/** A tab opened on `storage` that reconnects its stored choice, as a page load does; a repeat call is a reload. */
export async function loadedTab(storage: KeyStorage) {
  const kit = await tab(storage);
  kit.client.credited = true;
  saveChoice(storage, { kind: "injected" });
  await connectWallet(kit.store, "injected", true);
  return kit;
}

/** As `connected`, with this browser's session key already registered, as setup leaves it. */
export async function keyed(options: StubOptions = {}) {
  const kit = await connected(options);
  if (!(await loginSession(kit.store, "setup"))) throw new Error("the kit's login was refused");
  return kit;
}

/** A second store over its own client, as a move to another node builds one. */
export function nextStore(persistence = memoryStorage(), wallets: ConsoleStore["deps"]["wallets"] = { options: [], connect: async () => { throw new Error("a move connects no wallet of its own"); } }) {
  const client = new ActionClient();
  client.credited = true;
  const store = new ConsoleStore({ client, wallets, persistence, history: () => [], initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  store.start(0);
  return { client, store };
}

/** The account that signed `signature` over `typed`, lowercased. */
export const signerOf = (typed: TypedRequest, signature: string | undefined) =>
  // The typed data is viem's shape: domain, types, primaryType and message.
  recoverTypedDataAddress({ ...(typed as unknown as Parameters<typeof recoverTypedDataAddress>[0]), signature: (signature ?? "0x") as Hex }).then((a) => a.toLowerCase());
