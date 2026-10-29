/** The engine client for a real node: verified attestation, signed reads, and the signed stream. */

import type { AttestationStatus, FeedStatus } from "./attestation";
import { EngineError, type ActionResult, type ClientEvent, type EngineClient, type SignatureChecks, type Unsubscribe } from "./client";
import { LiveStream, type Scheduler, type Socket } from "./live-stream";
import { SignedTransport } from "./transport";
import { NodeTrust } from "./trust";
import type {
  AccountView, Address, Attestation, EligibilityView, HistoryPage, HouseView, MarketView, StreamMessage, WithdrawalPage,
} from "./types";
import type { Verifier } from "./verifier";
import { newChallenge } from "./wire";

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

/** How long a read of the node may take, in milliseconds. */
const READ_TIMEOUT_MS = 10_000;
/** How long loading the verifier may take, in milliseconds. */
const VERIFIER_LOAD_TIMEOUT_MS = 20_000;
const NOT_WIRED = "Signing is not available in this build yet.";

export class LiveEngineClient implements EngineClient {
  readonly signatures: SignatureChecks = "checked";
  private verifierReady: Promise<Verifier> | null = null;
  private loaded: Verifier | null = null;
  private readonly trust: NodeTrust;
  private readonly transport: SignedTransport;
  private readonly listeners = new Set<(event: ClientEvent) => void>();
  private readonly subscribers = new Set<(message: StreamMessage) => void>();
  private stream: LiveStream | null = null;

  constructor(private readonly deps: LiveDeps) {
    const challenge = deps.challenge ?? (() => newChallenge());
    this.trust = new NodeTrust({
      attestation: () => this.plainText("/v1/attestation"),
      collateral: () => this.collateral(),
      verifier: () => this.verifier(), manifests: deps.manifests, acceptsMock: deps.acceptsMock, nowMs: deps.nowMs,
      onStatus: (status) => this.emit({ type: "attestation", status }),
      onEnclaveChanged: () => this.emit({ type: "enclave" }),
    });
    this.transport = new SignedTransport({ ...deps, verifier: () => this.requireVerifier(), trust: this.trust, challenge, signal: this.signal });
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

  /** An unsigned read of a route the attestation itself authenticates: its status, and its body as text when 200. */
  private async plain(path: string): Promise<{ status: number; text: string }> {
    try {
      const response = await this.deps.fetch(this.deps.origin + path, { cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: this.signal() });
      return { status: response.status, text: response.status === 200 ? await response.text() : "" };
    } catch (cause) {
      throw new EngineError(0, "The node did not answer.", null, { cause });
    }
  }

  private async plainText(path: string): Promise<string> {
    const { status, text } = await this.plain(path);
    if (status !== 200) throw new EngineError(status, `The node did not serve ${path} (HTTP ${status}).`);
    return text;
  }

  async attestation(): Promise<Attestation> {
    // The quote binds these fields and the verifier checks them; a wrong shape fails there.
    return JSON.parse(await this.plainText("/v1/attestation")) as Attestation;
  }

  private async collateral(): Promise<string | null> {
    const { status, text } = await this.plain("/v1/attestation/collateral");
    if (status === 404) return null;
    if (status !== 200) throw new EngineError(status, `The node did not serve the attestation's collateral (HTTP ${status}).`);
    return text;
  }

  async verify(): Promise<AttestationStatus> {
    await this.trust.verify();
    return this.trust.status;
  }

  // The routes' bodies are signed by the attested enclave, so their shape is the engine's.
  async markets(): Promise<MarketView[]> {
    return (await this.transport.get("/v1/markets")) as MarketView[];
  }

  async house(): Promise<HouseView> {
    return (await this.transport.get("/v1/house")) as HouseView;
  }

  async account(address: Address): Promise<AccountView> {
    return (await this.transport.get(`/v1/accounts/${address}`)) as AccountView;
  }

  /** The engine has no region route: it screens each action, so a live client learns of a refusal from the action. */
  async accessProbe(): Promise<void> {}

  async nonce(address: Address): Promise<{ next_nonce: number }> {
    return (await this.transport.get(`/v1/accounts/${address}/nonce`)) as { next_nonce: number };
  }

  async eligibility(address: Address): Promise<EligibilityView> {
    return (await this.transport.get(`/v1/accounts/${address}/eligibility`)) as EligibilityView;
  }

  async withdrawalQueue(address: Address): Promise<WithdrawalPage> {
    return (await this.transport.get(`/v1/accounts/${address}/withdrawals`)) as WithdrawalPage;
  }

  async history(address: Address, params: { limit?: number; before?: string }): Promise<HistoryPage> {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.before !== undefined) query.set("before", params.before);
    const suffix = query.size > 0 ? `?${query}` : "";
    return (await this.transport.get(`/v1/accounts/${address}/history${suffix}`)) as HistoryPage;
  }

  async attestEligibility(): Promise<ActionResult> {
    throw new EngineError(501, NOT_WIRED);
  }

  async placeOrder(): Promise<ActionResult> {
    throw new EngineError(501, NOT_WIRED);
  }

  async cancelOrder(): Promise<ActionResult> {
    throw new EngineError(501, NOT_WIRED);
  }

  async withdraw(): Promise<ActionResult> {
    throw new EngineError(501, NOT_WIRED);
  }

  subscribe(onMessage: (message: StreamMessage) => void): Unsubscribe {
    this.subscribers.add(onMessage);
    if (this.stream === null) {
      const stream = new LiveStream({
        ...this.deps, verifier: () => this.requireVerifier(), origin: this.deps.streamOrigin, trust: this.trust, challenge: this.deps.challenge ?? (() => newChallenge()),
        onMessage: (message) => { for (const subscriber of this.subscribers) subscriber(message); },
        onFeed: (status: FeedStatus) => this.emit({ type: "feed", status }),
        onProblem: (reason) => this.emit({ type: "problem", reason }),
      });
      this.stream = stream;
      stream.start();
    }
    return () => {
      this.subscribers.delete(onMessage);
      if (this.subscribers.size === 0) {
        this.stream?.stop();
        this.stream = null;
      }
    };
  }
}
