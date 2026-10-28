/** An in-browser engine node that answers as the real node's REST and stream routes do. */

import { EngineError, type ActionResult, type EngineClient, type Unsubscribe } from "../engine/client";
import type {
  AccountView, Address, Attestation, CancelRequest, EligibilityRequest, EligibilityView, HistoryPage, HouseView,
  MarketView, OrderRequest, StreamMessage, WithdrawalPage, WithdrawalRequest,
} from "../engine/types";
import { fixedToWire } from "../fixed";
import { equityOf, houseGross, houseNav, marginOf } from "./accounts";
import { attestEligibility, cancelOrder, checkAccess, placeOrder } from "./orders";
import { queuePage, withdraw } from "./funds";
import { advance } from "./step";
import type { MockState } from "./state";

const HEX = "0123456789abcdef";

/** A deterministic hex string of `bytes` bytes derived from `seed`, for the mock's fixed fields. */
export function mockHex(seed: string, bytes: number): string {
  let h = 2166136261;
  let out = "";
  for (let i = 0; i < bytes * 2; i++) {
    h = Math.imul(h ^ (seed.charCodeAt(i % seed.length) + i), 16777619) >>> 0;
    out += HEX[h % 16];
  }
  return out;
}

const MOCK_QUOTE_PREFIX = "MOCK-ATTESTATION-NOT-A-TEE:";
const toHex = (text: string) => Array.from(text, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

/** How the node's attestation presents: the node's own mock quote, or a hardware quote nothing here can verify. */
export type AttestationMode = "mock" | "unverifiable";

export class MockEngineClient implements EngineClient {
  attestationMode: AttestationMode = "mock";

  constructor(readonly state: MockState) {}

  /** Advances the node's clock to `ms`. */
  tick(ms: number): void {
    advance(this.state, ms);
  }

  /** The newest messages of the log, oldest first: what a client that has just connected backfills. */
  recentLog(count: number): StreamMessage[] {
    return this.state.log.slice(-count);
  }

  async attestation(): Promise<Attestation> {
    const bundle = mockHex("bundle", 84);
    const reportData = mockHex("report", 64);
    const mock = this.attestationMode === "mock";
    return {
      provider: mock ? "mock" : "sev_snp",
      enclave_address: `0x${mockHex("enclave", 20)}`,
      config_sha256: mockHex("config", 32),
      tls_public_key_sha256: mockHex("tls", 32),
      bundle,
      report_data: reportData,
      quote: mock ? toHex(MOCK_QUOTE_PREFIX) + reportData : mockHex("quote", 96),
    };
  }

  async markets(): Promise<MarketView[]> {
    return this.marketViews();
  }

  /** The `GET /v1/markets` rows now, without waiting: the first server render reads these. */
  marketViews(): MarketView[] {
    return [...this.state.markets.values()].map(({ listed, open, halted, reduceOnly, mid, stress }) => ({
      ...listed.spec,
      open: open && !halted,
      reduce_only: reduceOnly,
      mark: fixedToWire(mid),
      stress_level: stress,
    }));
  }

  async house(): Promise<HouseView> {
    return this.houseView();
  }

  houseView(): HouseView {
    return { cash: fixedToWire(this.state.houseCash), nav: fixedToWire(houseNav(this.state)), gross_exposure: fixedToWire(houseGross(this.state)) };
  }

  async account(address: Address): Promise<AccountView> {
    const account = this.state.accounts.get(address.toLowerCase());
    if (!account) throw new EngineError(404, "not found");
    const positions: AccountView["positions"] = {};
    for (const [id, held] of account.positions) positions[id] = { qty: fixedToWire(held.qty), entry: fixedToWire(held.entry) };
    const orders: AccountView["orders"] = {};
    for (const [id, order] of account.orders) orders[id] = order;
    const pending = account.pending.reduce((sum, deposit) => sum + deposit.amount, 0n);
    return {
      balance: fixedToWire(account.balance),
      ...(pending > 0n ? { unfinalised_deposits: fixedToWire(pending) } : {}),
      equity: fixedToWire(equityOf(this.state, account)),
      margin: fixedToWire(marginOf(this.state, account)),
      positions,
      orders,
      toxicity_bps: 0,
    };
  }

  async nonce(address: Address): Promise<{ next_nonce: number }> {
    return { next_nonce: this.state.account(address).nextNonce };
  }

  async eligibility(address: Address): Promise<EligibilityView> {
    checkAccess(this.state); // the node screens the caller on public reads too
    const given = this.state.account(address).eligibility;
    const statement = given === "professional" ? "I attest that I am a professional client." : "I attest that I am an eligible client.";
    return { class: given, statement: given ? statement : null };
  }

  async attestEligibility(request: EligibilityRequest): Promise<ActionResult> {
    return attestEligibility(this.state, request);
  }

  async placeOrder(request: OrderRequest): Promise<ActionResult> {
    return placeOrder(this.state, request);
  }

  async cancelOrder(request: CancelRequest): Promise<ActionResult> {
    return cancelOrder(this.state, request);
  }

  async withdraw(request: WithdrawalRequest): Promise<ActionResult> {
    return withdraw(this.state, request);
  }

  async withdrawalQueue(address: Address): Promise<WithdrawalPage> {
    return queuePage(this.state, address);
  }

  async history(address: Address, params: { limit?: number; before?: string }): Promise<HistoryPage> {
    const items = this.state.history.get(address.toLowerCase()) ?? [];
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const beforeSeq = params.before ? Number(params.before.split(":")[0]) : Number.POSITIVE_INFINITY;
    const newest = items.filter((item) => Number(item.offset.split(":")[0]) < beforeSeq).reverse();
    const page = newest.slice(0, limit);
    const last = page[page.length - 1];
    return { events: page, next: newest.length > limit && last ? last.offset : null };
  }

  subscribe(onMessage: (message: StreamMessage) => void): Unsubscribe {
    this.state.listeners.add(onMessage);
    return () => {
      this.state.listeners.delete(onMessage);
    };
  }
}
