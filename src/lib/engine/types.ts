/**
 * The engine node's REST and stream shapes as the console uses them, field for field as
 * `crates/node/src/api` and `crates/core/src` serialize them: amounts are decimal strings,
 * identifiers numbers, and every enum is snake_case.
 */

export type Address = string;
export type MarketId = number;
export type OrderId = number;
export type Side = "buy" | "sell";

export type AssetClass = "fx" | "index" | "commodity" | "equity" | "crypto";

export interface Tier {
  up_to: string | null;
  bps: number;
}

export interface Window {
  open: string;
  close: string;
}

export type Schedule =
  | { kind: "always_open" }
  | { kind: "weekly"; tz: string; windows: Window[]; closed_dates: string[] };

/** One row of `GET /v1/markets`: the market's spec with its live state. */
export interface MarketView {
  id: MarketId;
  symbol: string;
  asset_class: AssetClass;
  schedule: Schedule;
  margin_tiers: Tier[];
  spread_tiers: Tier[];
  max_slippage_bps: number;
  house_cap_bps: number;
  min_order_notional: string;
  open: boolean;
  reduce_only: boolean;
  mark: string | null;
  stress_level: number;
}

/** `GET /v1/house`. */
export interface HouseView {
  cash: string;
  nav: string;
  gross_exposure: string;
}

export interface Position {
  qty: string;
  entry: string;
}

export type OrderKind =
  | { type: "market"; quoted: string; max_slippage_bps?: number }
  | { type: "limit"; price: string }
  | { type: "stop"; price: string };

export interface RestingOrder {
  order_id: OrderId;
  client_id: number;
  market: MarketId;
  side: Side;
  qty: string;
  kind: OrderKind;
  reduce_only: boolean;
}

/** `GET /v1/accounts/{address}`. */
export interface AccountView {
  balance: string;
  unfinalised_deposits?: string;
  equity: string;
  margin: string;
  positions: Record<string, Position>;
  orders: Record<string, RestingOrder>;
  toxicity_bps: number;
}

/** The account's signature, nonce, and expiry. */
export interface RequestAuth {
  nonce: number;
  expires_at: number;
  signature: string;
}

export interface OrderRequest {
  account: Address;
  client_id: number;
  market: MarketId;
  side: Side;
  qty: string;
  kind: OrderKind;
  reduce_only?: boolean;
  auth?: RequestAuth;
}

export interface CancelRequest {
  account: Address;
  order_id: OrderId;
  auth?: RequestAuth;
}

export interface WithdrawalRequest {
  account: Address;
  amount: string;
  auth?: RequestAuth;
}

export type EligibilityClass = "professional" | "eligible_client";

export interface EligibilityRequest {
  account: Address;
  class: EligibilityClass;
  auth: RequestAuth;
}

/** `GET /v1/accounts/{address}/eligibility`. */
export interface EligibilityView {
  class: EligibilityClass | null;
  statement: string | null;
}

export type AccessReject = "united_states" | "sanctioned_jurisdiction" | "eligibility_required" | "already_attested";

export type Reject =
  | { type: "access"; reason: AccessReject }
  | { type: "market_closed" }
  | { type: "reduce_only" }
  | { type: "no_price" }
  | { type: "unknown_market" }
  | { type: "unknown_order" }
  | { type: "invalid_order"; reason: string }
  | { type: "invalid_amount" }
  | { type: "slippage"; quoted: string; live: string; slippage_bps: number }
  | { type: "insufficient_margin"; equity: string; required: string }
  | { type: "insufficient_funds"; available: string }
  | { type: "house_capacity" }
  | { type: "invalid_signature" }
  | { type: "missing_signature" }
  | { type: "invalid_nonce"; expected: number }
  | { type: "payout_unavailable" };

export interface Fill {
  account: Address;
  order_id: OrderId;
  market: MarketId;
  side: Side;
  qty: string;
  price: string;
  index: string;
  spread_bps: number;
  realised_pnl: string;
  profit_fee: string;
  position: string;
  liquidation: boolean;
}

/** The events the console reads from the log, tagged by `type`. */
export type EngineEvent =
  | { type: "eligibility_attested"; account: Address; class: EligibilityClass }
  | { type: "deposited"; account: Address; amount: string }
  | { type: "order_accepted"; account: Address; client_id: number; order_id: OrderId }
  | { type: "order_rejected"; account: Address; client_id: number; reason: Reject }
  | { type: "order_cancelled"; account: Address; order_id: OrderId; reason: "client" | "unfillable" }
  | ({ type: "fill" } & Fill)
  | { type: "close_out"; account: Address; equity: string; margin: string }
  | { type: "withdrawal_approved"; account: Address; amount: string; nonce: number }
  | { type: "withdrawal_queued"; account: Address; amount: string; requested_seq: number }
  | { type: "withdrawal_queue_updated"; account: Address; requested_seq: number; remaining: string }
  | { type: "withdrawal_rejected"; account: Address; amount: string; reason: Reject }
  | { type: "market_opened"; market: MarketId }
  | { type: "market_closed"; market: MarketId }
  | { type: "stress_changed"; market: MarketId; level: number };

export interface SourceQuote {
  source: string;
  mid: string;
  ts: number;
}

/** A sequenced command, tagged by `type` as the engine's `Command` is; only the ones the console reads. */
export type EngineCommand =
  | { type: "prices"; market: MarketId; quotes: SourceQuote[] }
  | { type: "tick" }
  | { type: "place_order" | "cancel_order" | "withdraw" | "deposit" | "attest_eligibility" | "admin" };

/** One message of the WebSocket stream at `/v1/stream`: a sequenced command with its events. */
export interface StreamMessage {
  offset: string;
  type: "command";
  seq: number;
  ts: number;
  cmd: EngineCommand;
  events: EngineEvent[];
}

/** `GET /v1/attestation`. */
export interface Attestation {
  provider: string;
  enclave_address: string;
  config_sha256: string;
  tls_public_key_sha256: string;
  bundle: string;
  report_data: string;
  quote: string;
}

export interface QueuedWithdrawal {
  position: number;
  account: Address;
  amount: string;
  remaining: string;
  requested_seq: number;
}

/** `GET /v1/accounts/{address}/withdrawals`. */
export interface WithdrawalPage {
  seq: number | null;
  queue: QueuedWithdrawal[];
  next: number | null;
}

export interface HistoryPage {
  events: { offset: string; ts: number; event: EngineEvent }[];
  next: string | null;
}
