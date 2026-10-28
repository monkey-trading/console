/** The interface the console talks to an engine node through; a live client replaces the mock. */

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

  constructor(status: number, message: string, reject: Reject | null = null) {
    super(message);
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

/**
 * The engine node's client API. Reads mirror `GET /v1/…`, actions mirror the signed `POST /v1/…`
 * routes, and `subscribe` mirrors the resumable WebSocket at `/v1/stream`.
 * Error cases (every method):
 * - the node refuses the request: rejects with an `EngineError` carrying the status and message
 */
export interface EngineClient {
  attestation(): Promise<Attestation>;
  markets(): Promise<MarketView[]>;
  house(): Promise<HouseView>;
  /** Rejects with a 404 `EngineError` for an account the engine has never credited. */
  account(address: Address): Promise<AccountView>;
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
