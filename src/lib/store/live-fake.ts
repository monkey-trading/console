/** Tests only: a live client with canned reads, and a store over it. */

import { EngineError, type ClientEvent, type EngineClient } from "../engine/client";
import type { ScanBudget, ScannedMark } from "../engine/live-marks";
import type { SessionRule } from "../engine/mark-session";
import type { MarketView, PriceRules, StreamMessage } from "../engine/types";
import { WatchConnector } from "../engine/watch-wallet";
import { ConsoleStore } from "./store";

export const BTC: MarketView = {
  id: 1, symbol: "BTC-USD", open: true, reduce_only: false, mark: "100000", fx_mark: null, stress_level: 0,
  price_rules: { max_age_ms: 1_000, max_divergence_bps: 25, min_sources: 2 },
  schedule: { kind: "always_open" },
} as unknown as MarketView;
export const ACCOUNT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

/** A client with canned reads and a handle to push its events and stream messages. */
export class FakeClient implements EngineClient {
  signatures = "checked" as const;
  deployment = { chainId: 31337, vault: "0x5fbdb2315678afecb367f032d93f642f64180aa3" };
  /** The log head signed reads answer at, or null before any; a test may set it. */
  headSeq: number | null = null;
  marks: ScannedMark[] = [];
  scans: { fromSeq: number; budget: ScanBudget; rules: Readonly<Record<number, PriceRules>>; sessions: Readonly<Record<number, SessionRule>> }[] = [];
  listener: ((event: ClientEvent) => void) | null = null;
  onMessage: ((message: StreamMessage) => void) | null = null;
  marketReads = 0;
  accountError: Error | null = null;
  status: Awaited<ReturnType<EngineClient["verify"]>> = { kind: "mock" };
  async attestation(): Promise<never> { throw new Error("unused"); }
  async verify() { return this.status; }
  watch(listener: (event: ClientEvent) => void) { this.listener = listener; return () => { this.listener = null; }; }
  async markets() { this.marketReads++; return this.marketList; }
  marketList: MarketView[] = [BTC];
  async house() { return { cash: "5", nav: "5", gross_exposure: "0" }; }
  async account(): Promise<never> { throw this.accountError ?? new EngineError(404, "not found"); }
  async accessProbe() {}
  async nonce() { return { next_nonce: 0 }; }
  async eligibility() { return { class: null, statement: null }; }
  async attestEligibility(): Promise<never> { throw new EngineError(501, "no"); }
  async placeOrder(): Promise<never> { throw new EngineError(501, "no"); }
  async cancelOrder(): Promise<never> { throw new EngineError(501, "no"); }
  async withdraw(): Promise<never> { throw new EngineError(501, "no"); }
  async reissue(): Promise<never> { throw new EngineError(501, "no"); }
  async findWithdrawal() { return { withdrawal: null, complete: true, reached: null }; }
  async scanMarks(fromSeq: number, budget: ScanBudget, rules: Readonly<Record<number, PriceRules>>, sessions: Readonly<Record<number, SessionRule>>) { this.scans.push({ fromSeq, budget, rules, sessions }); return this.marks; }
  quotes() {}
  async withdrawalQueue() { return { seq: 1, queue: [], next: null }; }
  async history() { return { events: [], next: null }; }
  subscribe(onMessage: (message: StreamMessage) => void) { this.onMessage = onMessage; return () => { this.onMessage = null; }; }
}

export function setup() {
  const client = new FakeClient();
  const store = new ConsoleStore({
    client, wallets: new WatchConnector(() => `?account=${ACCOUNT}`), history: () => [],
    initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 },
  });
  return { client, store };
}
