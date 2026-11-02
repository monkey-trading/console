/** An in-browser engine node that answers as the real node's REST and stream routes do. */

import { checkAttestation, type AttestationStatus } from "../engine/attestation";
import { EngineError, type ActionResult, type EngineClient, type SignatureChecks, type Unsubscribe } from "../engine/client";
import type { EntitlementProof } from "../engine/emissions";
import type { EligibilityClass, AccountView, Address, Attestation, CancelRequest, EligibilityRequest, EligibilityView, HistoryPage, HouseView, OrderRequest, PayoutsPage, StreamMessage, WithdrawalPage, WithdrawalRequest, MarketView } from "../engine/types";
import type { MarkPage } from "../engine/mark-types";
import type { CheckpointEntry } from "../engine/wire";
import type { HouseParams, QueueTotals } from "../house";
import { fixedToWire } from "../fixed";
import { equityOf, houseGross, houseNav, marginOf } from "./accounts";
import { attestEligibility, cancelOrder, checkAccess, placeOrder } from "./orders";
import { queuePage, withdraw } from "./funds";
import { advance } from "./step";
import { CHECKPOINT_EVERY, type MockState } from "./state";

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

/**
 * The latest checkpoint a log ending at `headSeq` would hold: one checkpoint per `CHECKPOINT_EVERY`
 * sequenced commands, the mock's compressed stand-in for the node's `checkpoint_every` cadence.
 */
export function mockCheckpoint(headSeq: number): CheckpointEntry | null {
  const seq = headSeq - (headSeq % CHECKPOINT_EVERY);
  if (seq === 0) return null;
  return { type: "checkpoint", offset: `${seq}:1`, seq, root: `0x${mockHex(`checkpoint:${seq}`, 32)}` };
}

/** The public withdrawal queue's size, summed from its entries. */
export function mockTotals(state: MockState): QueueTotals {
  let remaining = 0n;
  for (const entry of state.queue) remaining += entry.remaining;
  return { count: state.queue.length, remaining, seq: state.seq, complete: true, stable: true };
}

/** How the node's attestation presents: the node's own mock quote, or a hardware quote nothing here can verify. */
export type AttestationMode = "mock" | "unverifiable";

export class MockEngineClient implements EngineClient {
  readonly signatures: SignatureChecks = "none";
  /** A stand-in deployment: the mock checks no signature, so nothing binds to it. */
  readonly deployment = { chainId: 31337, vault: `0x${mockHex("vault", 20)}` };
  /** The mock keeps its whole log in memory, so its head seq is always known. */
  get headSeq(): number | null {
    return this.state.log[this.state.log.length - 1]?.seq ?? null;
  }
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

  /** The mock accepts its own quote and cannot verify a hardware one. */
  async verify(): Promise<AttestationStatus> {
    const attestation = await this.attestation();
    return checkAttestation(attestation, true) ?? {
      kind: "unverified",
      reason: `The ${attestation.provider} quote cannot be verified here: this build does not check vendor certificate chains or a release manifest.`,
    };
  }

  /** The mock's trust and feed never change, so there is nothing to report. */
  watch(): Unsubscribe {
    return () => {};
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

  /** The solvency parameters in force, as the mock's launch genesis set them. */
  setHouseLogOpen(): void {}

  async houseParams(): Promise<HouseParams> {
    return this.state.params;
  }

  /**
   * The house panel's state now, without waiting; what the mock branch of the session passes as the
   * store's initial state, so the page's first paint carries it.
   */
  housePanelSnapshot(): { params: HouseParams; checkpoint: CheckpointEntry | null; totals: QueueTotals } {
    return {
      params: this.state.params,
      checkpoint: mockCheckpoint(this.headSeq ?? 0),
      totals: mockTotals(this.state),
    };
  }

  /**
   * The latest checkpoint the mock's log would hold: its cadence is one checkpoint per
   * `CHECKPOINT_EVERY` sequenced commands, as the node's `checkpoint_every` sets it. The root is a
   * deterministic stand-in — the mock computes no Merkle roots.
   */
  async latestCheckpoint(): Promise<CheckpointEntry | null> {
    return mockCheckpoint(this.headSeq ?? 0);
  }

  /** The mock answers from its state, so its log read is always current. */
  async houseLogStatus(): Promise<"current" | "reading" | "failed"> {
    return "current";
  }

  /** The public queue's size, summed from its entries. */
  async withdrawalTotals(): Promise<QueueTotals> {
    return mockTotals(this.state);
  }

  async account(address: Address): Promise<AccountView> {
    const view = this.accountView(address);
    if (!view) throw new EngineError(404, "not found");
    return view;
  }

  /** `GET /v1/accounts/{address}` now, without waiting; null for an account the node has never credited. */
  accountView(address: Address): AccountView | null {
    const account = this.state.accounts.get(address.toLowerCase());
    if (!account) return null;
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

  /** Mock only: what a live node would tell the console about the caller's region. It is not a node route. */
  async accessProbe(): Promise<void> {
    checkAccess(this.state);
  }

  async nonce(address: Address): Promise<{ next_nonce: number }> {
    return { next_nonce: this.state.accounts.get(address.toLowerCase())?.nextNonce ?? 0 };
  }

  async eligibility(address: Address): Promise<EligibilityView> {
    const given = this.state.accounts.get(address.toLowerCase())?.eligibility ?? null;
    const statement = given === "professional" ? "I attest that I am a professional client." : "I attest that I am an eligible client.";
    return { class: given, statement: given ? statement : null };
  }

  /** The account's cumulative MONKEY entitlement with its proof, against the mock vault's latest posted checkpoint; null when no allocation has reached it, as the node's 404. */
  async emissions(address: Address): Promise<EntitlementProof | null> {
    const entitled = this.state.entitledMonkey.get(address.toLowerCase());
    if (entitled === undefined) return null;
    return { seq: this.state.postedSeq, root: `0x${mockHex("emission-root", 64)}`, account: address, entitled: entitled.toString(), siblings: [] };
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

  /** The mock pays approved withdrawals itself, so it signs no authorization to reissue. */
  async reissue(): Promise<never> {
    throw new EngineError(404, "not found");
  }

  /** The mock pays every approval at once, so it holds no unpaid one: a loaded, empty list at its head. */
  async payouts(): Promise<PayoutsPage> {
    return { seq: this.headSeq, loaded: true, payouts: [], next: null };
  }

  /** The mock seeds its own chart history; there is no log scan to run. */
  async scanMarks() {
    return [];
  }

  /**
   * The mock's charts seed from its own history, not from a marks read, so it serves none; the
   * store asks only a signature-checking client for history this way.
   */
  async marks(): Promise<MarkPage> {
    return { entries: [], next: null };
  }

  /** The mock streams no executable quotes; the ticket shows its own estimate. */
  quotes(): void {}

  async withdrawalQueue(address: Address): Promise<WithdrawalPage> {
    return queuePage(this.state, address);
  }

  /** The account's recorded eligibility class now, without waiting. */
  eligibilityClass(address: Address): EligibilityClass | null {
    return this.state.accounts.get(address.toLowerCase())?.eligibility ?? null;
  }

  async history(address: Address, params: { limit?: number; before?: string; kind?: string }): Promise<HistoryPage> {
    return this.historyPage(address, params);
  }

  /** `GET /v1/accounts/{address}/history` now, without waiting. */
  historyPage(address: Address, params: { limit?: number; before?: string; kind?: string }): HistoryPage {
    const items = (this.state.history.get(address.toLowerCase()) ?? []).filter((item) => params.kind === undefined || item.event.type === params.kind);
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const [beforeSeq = Number.POSITIVE_INFINITY, beforeIndex = 0] = params.before ? params.before.split(":").map(Number) : [];
    // Strictly older than the cursor, which names one event, not the whole command.
    const older = items.filter((item) => item.seq < beforeSeq || (item.seq === beforeSeq && item.index < beforeIndex)).reverse();
    const page = older.slice(0, limit);
    const last = page[page.length - 1];
    return { events: page.map((item) => ({ ...item.event, cursor: item.cursor, ts: item.ts })), next: older.length > limit && last ? last.cursor : null };
  }

  subscribe(onMessage: (message: StreamMessage) => void): Unsubscribe {
    this.state.listeners.add(onMessage);
    return () => {
      this.state.listeners.delete(onMessage);
    };
  }
}
