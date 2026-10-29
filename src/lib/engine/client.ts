/** The interface the console talks to an engine node through; a live client replaces the mock. */

import type { AttestationStatus, FeedStatus } from "./attestation";
import type {
  AccountView,
  Address,
  Attestation,
  CancelRequest,
  EligibilityRequest,
  EligibilityView,
  HistoryPage,
  HouseView,
  MarketView,
  OrderRequest,
  Reject,
  StreamMessage,
  WithdrawalPage,
  WithdrawalRequest,
} from "./types";

/**
 * An error response from the node: the HTTP status and the `{ "error": … }` message, plus the typed
 * refusal when the engine rejected a sequenced command.
 */
export class EngineError extends Error {
  readonly status: number;
  readonly reject: Reject | null;

  constructor(status: number, message: string, reject: Reject | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "EngineError";
    this.status = status;
    this.reject = reject;
  }
}

/** What a sequenced action returns: the events its command produced, in log order. */
export interface ActionResult {
  seq: number;
  events: StreamMessage["events"];
}

/** Unsubscribes from the stream. */
export type Unsubscribe = () => void;

/** What a client reports about its trust in the node, whether its feed is arriving, and why it dropped the stream. */
export type ClientEvent =
  | { type: "attestation"; status: AttestationStatus }
  | { type: "feed"; status: FeedStatus }
  /** The node's answers now come from another enclave address than before. */
  | { type: "enclave" }
  /** Why the stream was dropped, written for the user. */
  | { type: "problem"; reason: string };

/**
 * Whether a client checks the signatures on the node's answers: `checked` for a live client, `none`
 * for the mock, which has none.
 */
export type SignatureChecks = "checked" | "none";

/**
 * The engine node's client API. Reads mirror `GET /v1/…`, actions mirror the signed `POST /v1/…`
 * routes, and `subscribe` mirrors the resumable WebSocket at `/v1/stream`.
 * Error cases (every method):
 * - the node refuses the request: rejects with an `EngineError` carrying the status and message
 * - a live client receives an answer that is unsigned or does not verify: rejects with an `UntrustedError`, and the answer is not shown
 */
export interface EngineClient {
  readonly signatures: SignatureChecks;
  attestation(): Promise<Attestation>;
  /** Judges the node's attestation; a live client does so again whenever the enclave changes. */
  verify(): Promise<AttestationStatus>;
  /** Reports each change of attestation status and of the feed. */
  watch(listener: (event: ClientEvent) => void): Unsubscribe;
  markets(): Promise<MarketView[]>;
  house(): Promise<HouseView>;
  /** Rejects with a 404 `EngineError` for an account the engine has never credited. */
  account(address: Address): Promise<AccountView>;
  /**
   * Whether the node serves the caller's region; rejects with a 403 access `EngineError` if not.
   * The engine has no such route, since it screens each action as it is sequenced, so a live client
   * derives the answer from the node's refusals, or the node offers a probe (an open decision).
   */
  accessProbe(): Promise<void>;
  nonce(address: Address): Promise<{ next_nonce: number }>;
  eligibility(address: Address): Promise<EligibilityView>;
  attestEligibility(request: EligibilityRequest): Promise<ActionResult>;
  placeOrder(request: OrderRequest): Promise<ActionResult>;
  cancelOrder(request: CancelRequest): Promise<ActionResult>;
  withdraw(request: WithdrawalRequest): Promise<ActionResult>;
  withdrawalQueue(address: Address): Promise<WithdrawalPage>;
  history(address: Address, params: { limit?: number; before?: string }): Promise<HistoryPage>;
  /** Starts at the live end of the log and delivers each message once. */
  subscribe(onMessage: (message: StreamMessage) => void): Unsubscribe;
}
