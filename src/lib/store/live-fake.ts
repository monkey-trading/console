/** Tests only: a live client with canned reads, and a store over it. */

import { EngineError, type ActionResult, type ClientEvent, type EngineClient, type SignatureChecks } from "../engine/client";
import type { EmissionSchedule } from "../engine/emission-schedule";
import type { EntitlementProof } from "../engine/emissions";
import type { ScanBudget, ScannedMark } from "../engine/live-marks";
import type { SessionRule } from "../engine/mark-session";
import type { HistoryPage, PriceRules, StreamMessage, MarketView } from "../engine/types";
import type { MarkPage } from "../engine/mark-types";
import type { CheckpointEntry } from "../engine/wire";
import type { HouseParams, QueueTotals } from "../house";
import { WatchConnector } from "../engine/watch-wallet";
import type { StoreDeps } from "./store-deps";
import { ConsoleStore } from "./store";

export const BTC: MarketView = {
  id: 1, symbol: "BTC-USD", open: true, reduce_only: false, mark: "100000", fx_mark: null, stress_level: 0,
  price_rules: { max_age_ms: 1_000, max_divergence_bps: 25, min_sources: 2 },
  schedule: { kind: "always_open" },
} as unknown as MarketView;
export const ACCOUNT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

/** A client with canned reads and a handle to push its events and stream messages. */
export class FakeClient implements EngineClient {
  signatures: SignatureChecks = "checked";
  deployment = { chainId: 31337, vault: "0x5fbdb2315678afecb367f032d93f642f64180aa3" };
  /** The log head signed reads answer at, or null before any; a test may set it. */
  headSeq: number | null = null;
  /** The index marks `scanMarks` answers with; a test may set it. */
  scanned: ScannedMark[] = [];
  scans: { fromSeq: number; budget: ScanBudget; rules: Readonly<Record<number, PriceRules>>; sessions: Readonly<Record<number, SessionRule>> }[] = [];
  listener: ((event: ClientEvent) => void) | null = null;
  onMessage: ((message: StreamMessage) => void) | null = null;
  marketReads = 0;
  accountError: Error | null = null;
  /** Pages each marks read draws from, in order; the last one repeats. */
  marksPages: MarkPage[] = [{ entries: [], next: null }];
  marksReads: { market: number; resolution: string; fromMs: number; toMs: number }[] = [];
  status: Awaited<ReturnType<EngineClient["verify"]>> = { kind: "mock" };
  async attestation(): Promise<never> { throw new Error("unused"); }
  async verify() { return this.status; }
  watch(listener: (event: ClientEvent) => void) { this.listener = listener; return () => { this.listener = null; }; }
  /** When set, the markets read rejects with it, as a failing node answers. */
  marketError: Error | null = null;
  async markets() {
    this.marketReads++;
    if (this.marketError !== null) throw this.marketError;
    return this.marketList;
  }
  marketList: MarketView[] = [BTC];
  async house() { return { cash: "5", nav: "5", gross_exposure: "0" }; }
  /** Canned house-state reads, patched by a test; nulls answer "not read yet". */
  params: HouseParams | null = null;
  checkpoint: CheckpointEntry | null = null;
  totals: QueueTotals = { count: 0, remaining: 0n, seq: null, complete: true, stable: true };
  /** When set, the queue totals read rejects with it, as a failing node answers. */
  totalsError: Error | null = null;
  /** The log head the house state read answers at. */
  houseSeq: number | null = null;
  /** How many times the house state was read. */
  houseStateReads = 0;
  /** When set, the house state read rejects with it; `unavailable` answers as a node that predates the route does. */
  houseStateError: Error | null = null;
  unavailable = false;
  async houseState() {
    this.houseStateReads++;
    if (this.houseStateError !== null) throw this.houseStateError;
    return this.unavailable ? null : { seq: this.houseSeq, params: this.params, checkpoint: this.checkpoint };
  }
  async withdrawalTotals() { if (this.totalsError !== null) throw this.totalsError; return this.totals; }
  async account(): Promise<never> { throw this.accountError ?? new EngineError(404, "not found"); }
  async accessProbe() {}
  async nonce() { return { next_nonce: 0 }; }
  async eligibility() { return { class: null, statement: null }; }
  /** The account's entitlement proof; a test may set it. */
  entitlement: EntitlementProof | null = null;
  async emissions() { return this.entitlement; }
  async attestEligibility(): Promise<never> { throw new EngineError(501, "no"); }
  async placeOrder(): Promise<never> { throw new EngineError(501, "no"); }
  async cancelOrder(): Promise<never> { throw new EngineError(501, "no"); }
  async withdraw(): Promise<never> { throw new EngineError(501, "no"); }
  /** Canned session-key registration and revocation answers; a test may replace them. */
  sessionKeyResult: ActionResult = { seq: 1, events: [{ type: "session_key_registered", account: "0x0", session_key: "0x0", expires_at: 0 }] };
  async registerSessionKey(): Promise<ActionResult> { return this.sessionKeyResult; }
  async revokeSessionKey(): Promise<ActionResult> { return { seq: 1, events: [{ type: "session_key_revoked", account: "0x0", session_key: "0x0" }] }; }
  async reissue(): Promise<never> { throw new EngineError(501, "no"); }
  async payouts() { return { seq: null, loaded: true, payouts: [], next: null }; }
  async scanMarks(fromSeq: number, budget: ScanBudget, rules: Readonly<Record<number, PriceRules>>, sessions: Readonly<Record<number, SessionRule>>) { this.scans.push({ fromSeq, budget, rules, sessions }); return this.scanned; }
  async marks(market: number, resolution: "1s" | "1m" | "1h" | "1d", fromMs: number, toMs: number) {
    this.marksReads.push({ market, resolution, fromMs, toMs });
    const page = this.marksPages[Math.min(this.marksReads.length - 1, this.marksPages.length - 1)];
    if (page === undefined) throw new Error("no marks page canned");
    return page;
  }
  quotes() {}
  async withdrawalQueue() { return { seq: 1, queue: [], next: null }; }
  /** Canned history, replaced by a test: what each `history` read answers, and the reads made. */
  historyAnswer: (params: { kind?: string; before?: string; limit?: number }) => HistoryPage = () => ({ events: [], next: null });
  historyReads: { address: string; kind?: string; before?: string; limit?: number }[] = [];
  async history(address: string, params: { kind?: string; before?: string; limit?: number } = {}) { this.historyReads.push({ address, ...params }); return this.historyAnswer(params); }
  /** What `emissionSchedule` answers: a schedule, null for a node without the route, or an error. */
  schedule: EmissionSchedule | null | Error = null;
  scheduleReads = 0;
  async emissionSchedule() { this.scheduleReads++; if (this.schedule instanceof Error) throw this.schedule; return this.schedule; }
  subscribe(onMessage: (message: StreamMessage) => void) { this.onMessage = onMessage; return () => { this.onMessage = null; }; }
}

export function setup(extra: Partial<StoreDeps> = {}) {
  const client = new FakeClient();
  const store = new ConsoleStore({
    client, wallets: new WatchConnector(() => `?account=${ACCOUNT}`), history: () => [],
    initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 },
    ...extra,
  });
  return { client, store };
}
