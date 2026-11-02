/** The engine client for a real node: verified attestation, signed reads, and the signed stream. */

import type { AttestationStatus, FeedStatus } from "./attestation";
import { EngineError, type ActionResult, type ClientEvent, type EngineClient, type SignatureChecks, type Unsubscribe } from "./client";
import type { EntitlementProof } from "./emissions";
import { setParamsOf, type HouseParams, type QueueTotals } from "../house";
import { HouseLog, HOUSE_SCAN_CHUNK, scanHouse } from "./live-house";
import { QueueTotalsWalk } from "./live-queue";
import { collateral, plainText, READ_TIMEOUT_MS } from "./live-plain";
import { scanForMarks, type ScanBudget, type ScannedMark } from "./live-marks";
import type { SessionRule } from "./mark-session";
import { LiveStream, type QuoteRequest, type Scheduler, type Socket } from "./live-stream";
import { SignedTransport } from "./transport";
import { NodeTrust } from "./trust";
import type { AccountView, Address, Attestation, CancelRequest, EligibilityRequest, EligibilityView, HistoryPage, HouseView, OrderRequest, PayoutsPage, PriceRules, StreamMessage, WithdrawalPage, WithdrawalRequest, MarketId, MarketView } from "./types";
import type { MarkPage, MarkResolution } from "./mark-types";
import type { Verifier } from "./verifier";
import { newChallenge, type CheckpointEntry } from "./wire";

export interface LiveDeps {
  /** The node's `https://` origin. */
  origin: string;
  /** The node's `wss://` origin. */
  streamOrigin: string;
  chainId: number;
  vault: string;
  heartbeatMs: number;
  /** Loads the verifier; called once, when the node is first trusted. */
  loadVerifier(): Promise<Verifier>;
  manifests: readonly string[];
  acceptsMock: boolean;
  fetch: typeof fetch;
  openSocket(url: string): Socket;
  scheduler: Scheduler;
  nowMs(): number;
  challenge?: () => string;
  /** A signal that aborts a read of the node when it stalls; ten seconds by default. */
  signal?: () => AbortSignal;
}

/** How long loading the verifier may take, in milliseconds. */
const VERIFIER_LOAD_TIMEOUT_MS = 20_000;

export class LiveEngineClient implements EngineClient {
  readonly signatures: SignatureChecks = "checked";
  private verifierReady: Promise<Verifier> | null = null;
  private loaded: Verifier | null = null;
  private readonly trust: NodeTrust;
  private readonly transport: SignedTransport;
  private readonly listeners = new Set<(event: ClientEvent) => void>();
  private readonly subscribers = new Set<(message: StreamMessage) => void>();
  private stream: LiveStream | null = null;
  /** The quotes the page wants, kept for a stream opened later. */
  private quoteRequest: QuoteRequest | null = null;
  /** The log head seq of the last signed answer that named one; null before the first. */
  headSeq: number | null = null;
  readonly deployment: { chainId: number; vault: string };
  /** The fold of the log's house state: the latest `set_params` and checkpoint, kept fresh by the stream. */
  private readonly houseLog: HouseLog;
  /** The public withdrawal queue's size, walked within a page cap and cached for its TTL. */
  private readonly totalsWalk: QueueTotalsWalk;
  /** The public withdrawal queue's size, from the walk cached for its TTL. */
  readonly withdrawalTotals: () => Promise<QueueTotals>;
  /** The account's MONKEY entitlement proof, or null before the node holds one. */
  readonly emissions: (address: Address) => Promise<EntitlementProof | null>;

  constructor(private readonly deps: LiveDeps) {
    this.deployment = { chainId: deps.chainId, vault: deps.vault };
    const challenge = deps.challenge ?? (() => newChallenge());
    this.trust = new NodeTrust({
      attestation: () => plainText(deps, "/v1/attestation"),
      collateral: () => collateral(deps),
      verifier: () => this.verifier(), manifests: deps.manifests, acceptsMock: deps.acceptsMock, nowMs: deps.nowMs,
      onStatus: (status) => this.emit({ type: "attestation", status }),
      onEnclaveChanged: () => this.emit({ type: "enclave" }),
    });
    this.transport = new SignedTransport({ ...deps, verifier: () => this.requireVerifier(), trust: this.trust, challenge, signal: this.signal });
    this.houseLog = new HouseLog(async (fromSeq, skipPast, dead) => {
      const signer = await this.trust.signer();
      return scanHouse({ ...deps, origin: deps.streamOrigin, signer, verifier: this.requireVerifier(), challenge }, fromSeq, HOUSE_SCAN_CHUNK, skipPast, dead);
    }, deps.nowMs);
    this.totalsWalk = new QueueTotalsWalk(this.transport, deps.nowMs);
    this.withdrawalTotals = () => this.totalsWalk.totals();
    this.emissions = (address) =>
      this.transport.get(`/v1/accounts/${address}/emissions`).then(
        (proof) => proof as EntitlementProof,
        (error: unknown) => {
          if (error instanceof EngineError && error.status === 404) return null;
          throw error;
        },
      );
  }

  private emit(event: ClientEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  watch(listener: (event: ClientEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private readonly signal = (): AbortSignal => this.deps.signal?.() ?? AbortSignal.timeout(READ_TIMEOUT_MS);

  /** The verifier, loading it the first time. */
  private verifier(): Promise<Verifier> {
    if (this.verifierReady === null) {
      const timer = { handle: null as unknown };
      const deadline = new Promise<never>((_, reject) => {
        timer.handle = this.deps.scheduler.setTimeout(() => reject(new Error("The verifier took too long to load.")), VERIFIER_LOAD_TIMEOUT_MS);
      });
      this.verifierReady = Promise.race([this.deps.loadVerifier(), deadline]).then(
        (verifier) => {
          this.deps.scheduler.clearTimeout(timer.handle);
          return (this.loaded = verifier);
        },
        (error: unknown) => {
          this.deps.scheduler.clearTimeout(timer.handle);
          this.verifierReady = null; // a failed or stalled load is tried again on the next check
          throw error;
        },
      );
    }
    return this.verifierReady;
  }

  /** The loaded verifier; the trust check that precedes every use has loaded it. */
  private requireVerifier(): Verifier {
    if (this.loaded === null) throw new Error("The verifier was used before it loaded.");
    return this.loaded;
  }

  async attestation(): Promise<Attestation> {
    // The quote binds these fields and the verifier checks them; a wrong shape fails there.
    return JSON.parse(await plainText(this.deps, "/v1/attestation")) as Attestation;
  }

  async verify(): Promise<AttestationStatus> {
    await this.trust.verify();
    return this.trust.status;
  }

  // The routes' bodies are signed by the attested enclave, so their shape is the engine's.
  async markets(): Promise<MarketView[]> {
    const answer = await this.transport.getSigned("/v1/markets");
    this.headSeq = answer.seq;
    return answer.body as MarketView[];
  }

  async house(): Promise<HouseView> {
    return (await this.transport.get("/v1/house")) as HouseView;
  }

  /** The latest `set_params` folded so far; the catch-up read runs behind the answer when it is not done. */
  async houseParams(): Promise<HouseParams | null> {
    this.houseLog.kick();
    return this.houseLog.params;
  }

  /** The latest checkpoint folded so far. */
  async latestCheckpoint(): Promise<CheckpointEntry | null> {
    this.houseLog.kick();
    return this.houseLog.checkpoint;
  }

  setHouseLogOpen(open: boolean): void { if (open) this.houseLog.resume(); else this.houseLog.pause(); }

  /** The state of the log read feeding the fold. */
  async houseLogStatus(): Promise<"current" | "reading" | "failed"> {
    this.houseLog.kick();
    return this.houseLog.freshness;
  }

  async account(address: Address): Promise<AccountView> {
    return (await this.transport.get(`/v1/accounts/${address}`)) as AccountView;
  }

  /** The engine has no region route: it screens each action, so a live client learns of a refusal from the action. */
  async accessProbe(): Promise<void> {}

  async nonce(address: Address): Promise<{ next_nonce: number; time_ms: number }> {
    const answer = await this.transport.getSigned(`/v1/accounts/${address}/nonce`);
    // The attested enclave signed this answer to the nonce route, so its shape is the engine's.
    return { next_nonce: (answer.body as { next_nonce: number }).next_nonce, time_ms: answer.timeMs };
  }

  async eligibility(address: Address): Promise<EligibilityView> {
    return (await this.transport.get(`/v1/accounts/${address}/eligibility`)) as EligibilityView;
  }

  async withdrawalQueue(address: Address): Promise<WithdrawalPage> {
    return (await this.transport.get(`/v1/accounts/${address}/withdrawals`)) as WithdrawalPage;
  }

  async history(address: Address, params: { limit?: number; before?: string; kind?: string }): Promise<HistoryPage> {
    const query = new URLSearchParams();
    if (params.kind !== undefined) query.set("kind", params.kind);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.before !== undefined) query.set("before", params.before);
    const suffix = query.size > 0 ? `?${query}` : "";
    return (await this.transport.get(`/v1/accounts/${address}/history${suffix}`)) as HistoryPage;
  }

  /** Posts a signed action; the node answers with the events its command produced, signed for this request. */
  private async action(path: string, body: unknown): Promise<ActionResult> {
    const answer = await this.transport.post(path, body);
    if (!Array.isArray(answer.body)) throw new EngineError(0, "The node's signed answer to the action was not a list of events.");
    // The attested enclave signed this list for this request, so its events are the engine's.
    return { seq: answer.seq ?? 0, events: answer.body as ActionResult["events"] };
  }

  attestEligibility(request: EligibilityRequest): Promise<ActionResult> {
    return this.action("/v1/eligibility", request);
  }

  placeOrder(request: OrderRequest): Promise<ActionResult> {
    return this.action("/v1/orders", request);
  }

  cancelOrder(request: CancelRequest): Promise<ActionResult> {
    return this.action("/v1/orders/cancel", request);
  }

  withdraw(request: WithdrawalRequest): Promise<ActionResult> {
    return this.action("/v1/withdrawals", request);
  }

  async reissue(account: Address, nonce: number, body: { replaces_expires_at: number; signature: string }): Promise<void> {
    await this.transport.post(`/v1/accounts/${account}/withdrawals/${nonce}/reissue`, body);
  }

  async payouts(account: Address, page: { limit: number; after?: number }): Promise<PayoutsPage> {
    const query = new URLSearchParams({ limit: String(page.limit), ...(page.after === undefined ? {} : { after: String(page.after) }) });
    return (await this.transport.get(`/v1/accounts/${account}/payouts?${query}`)) as PayoutsPage;
  }

  async scanMarks(fromSeq: number, budget: ScanBudget, rules: Readonly<Record<number, PriceRules>>, sessions: Readonly<Record<number, SessionRule>>, dead?: () => boolean): Promise<ScannedMark[]> {
    // The backfill reads the signed log only: every mark the console plots derives from an enclave-signed frame.
    const signer = await this.trust.signer();
    return scanForMarks({ ...this.deps, origin: this.deps.streamOrigin, signer, verifier: this.requireVerifier(), challenge: this.deps.challenge ?? (() => newChallenge()) }, fromSeq, budget, rules, sessions, dead);
  }

  /** The market's index-mark history, one signed page; the enclave signs the shape, as every answer. */
  async marks(market: MarketId, resolution: MarkResolution, fromMs: number, toMs: number): Promise<MarkPage> {
    const query = new URLSearchParams({ resolution, from_ms: String(fromMs), to_ms: String(toMs) });
    return (await this.transport.get(`/v1/markets/${market}/marks?${query}`)) as MarkPage;
  }

  quotes(request: QuoteRequest | null): void {
    this.quoteRequest = request;
    this.stream?.setQuotes(request);
  }

  subscribe(onMessage: (message: StreamMessage) => void): Unsubscribe {
    this.subscribers.add(onMessage);
    if (this.stream === null) {
      // A new connection starts at the live end and can miss log entries, so the fold re-reads to the head.
      this.houseLog.uncaught();
      const stream = new LiveStream({
        ...this.deps, verifier: () => this.requireVerifier(), origin: this.deps.streamOrigin, trust: this.trust, challenge: this.deps.challenge ?? (() => newChallenge()),
        onMessage: (message) => {
          // The stream starts at the live end, so a `set_params` it carries is the latest the log
          // records; the catch-up read folds what predates the connection the same way.
          const entry = setParamsOf(message.cmd, message.events);
          if (entry !== null) this.houseLog.foldParams(message.seq, entry);
          for (const subscriber of this.subscribers) subscriber(message);
        },
        onQuote: (quote) => this.emit({ type: "quote", quote }),
        onQuoteError: (error) => this.emit({ type: "quote_error", error }),
        onWithdrawal: (withdrawal) => this.emit({ type: "withdrawal", withdrawal }),
        onCheckpoint: (checkpoint) => this.houseLog.foldCheckpoint(checkpoint),
        onProblem: (reason) => {
          this.houseLog.uncaught(); // the reconnection resumes at the live end: re-read the gap
          this.emit({ type: "problem", reason });
        },
        // A connection starts at the live end and names its signed time only once live: anything
        // sequenced between the last catch-up and this moment needs another catch-up read.
        onFeed: (status: FeedStatus, time?: number) => {
          if (status === "live") this.houseLog.uncaught();
          this.emit(time === undefined ? { type: "feed", status } : { type: "feed", status, time });
        },
      });
      this.stream = stream;
      stream.setQuotes(this.quoteRequest);
      stream.start();
    }
    return () => {
      this.subscribers.delete(onMessage);
      if (this.subscribers.size === 0) {
        this.stream?.stop();
        this.stream = null;
        // No one reads the fold now: stand the catch-up down instead of reading on for a stopped session.
        this.houseLog.cancel();
      }
    };
  }
}
