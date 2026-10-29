/** The engine client for a real node: verified attestation, signed reads, and the signed stream. */

import type { AttestationStatus, FeedStatus } from "./attestation";
import { EngineError, type ActionResult, type ClientEvent, type EngineClient, type SignatureChecks, type Unsubscribe } from "./client";
import { LiveStream, type Scheduler, type Socket } from "./live-stream";
import { SignedTransport } from "./transport";
import { NodeTrust } from "./trust";
import type {
  AccountView, Address, Attestation, EligibilityView, HistoryPage, HouseView, MarketView, StreamMessage, WithdrawalPage,
} from "./types";
import type { Collateral, Verifier } from "./verifier";
import { newChallenge } from "./wire";

export interface LiveDeps {
  /** The node's `https://` origin. */
  origin: string;
  /** The node's `wss://` origin. */
  streamOrigin: string;
  chainId: number;
  vault: string;
  heartbeatMs: number;
  verifier: Verifier;
  manifests: readonly string[];
  acceptsMock: boolean;
  fetch: typeof fetch;
  openSocket(url: string): Socket;
  scheduler: Scheduler;
  nowMs(): number;
  challenge?: () => string;
}

const NOT_WIRED = "Signing is not available in this build yet.";

export class LiveEngineClient implements EngineClient {
  readonly signatures: SignatureChecks;
  private readonly trust: NodeTrust;
  private readonly transport: SignedTransport;
  private readonly listeners = new Set<(event: ClientEvent) => void>();
  private readonly subscribers = new Set<(message: StreamMessage) => void>();
  private stream: LiveStream | null = null;

  constructor(private readonly deps: LiveDeps) {
    this.signatures = deps.verifier.checksSignatures ? "checked" : "unchecked";
    const challenge = deps.challenge ?? (() => newChallenge());
    this.trust = new NodeTrust({
      attestation: () => this.attestation(),
      collateral: () => this.collateral(),
      verifier: deps.verifier, manifests: deps.manifests, acceptsMock: deps.acceptsMock, nowMs: deps.nowMs,
      onStatus: (status) => this.emit({ type: "attestation", status }),
    });
    this.transport = new SignedTransport({ ...deps, trust: this.trust, challenge });
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

  /** An unsigned read of a route the attestation itself authenticates. */
  private async plain(path: string): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await this.deps.fetch(this.deps.origin + path, { cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
      return { status: response.status, body: response.status === 200 ? await response.json() : null };
    } catch (cause) {
      throw new EngineError(0, "The node did not answer.", null, { cause });
    }
  }

  async attestation(): Promise<Attestation> {
    const { status, body } = await this.plain("/v1/attestation");
    if (status !== 200) throw new EngineError(status, `The node did not serve its attestation (HTTP ${status}).`);
    // The quote binds these fields and the verifier checks them; a wrong shape fails there.
    return body as Attestation;
  }

  private async collateral(): Promise<Collateral | null> {
    const { status, body } = await this.plain("/v1/attestation/collateral");
    if (status === 404) return null;
    if (status !== 200) throw new EngineError(status, `The node did not serve the attestation's collateral (HTTP ${status}).`);
    // The verifier checks the chain to a pinned root; a wrong shape fails there.
    return body as Collateral;
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
        ...this.deps, origin: this.deps.streamOrigin, trust: this.trust, challenge: this.deps.challenge ?? (() => newChallenge()),
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
