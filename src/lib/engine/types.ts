/**
 * The engine node's REST and stream shapes as the console uses them, field for field as
 * `crates/node/src/api` and `crates/core/src` serialize them: amounts are decimal strings,
 * identifiers numbers, and every enum is snake_case.
 */

import type { EngineEvent } from "./event-types";
export type { EngineEvent } from "./event-types";
import type { HouseScanView } from "./stats-types";

export type Address = string;
export type MarketId = number;
export type OrderId = number;
export type Side = "buy" | "sell";

export type AssetClass = "fx" | "index" | "commodity" | "equity" | "crypto";

export interface Tier {
  up_to: string | null;
  bps: number;
}

import type { Schedule } from "./schedule-types";
export type { LocalPeriod, Schedule, Window } from "./schedule-types";

/** A futures contract a market prices from, in roll order; `from` is when the index rolls onto it, as the wire's RFC 3339 timestamp. */
export interface FuturesContract { contract: string; from: string }

/** A market's index rules, as `GET /v1/markets` lists them (`engine_core::market::PriceRules`). */
export interface PriceRules {
  max_age_ms: number;
  max_divergence_bps: number;
  min_sources: number;
}

/** One row of `GET /v1/markets`: the market's spec with its live state. */
export interface MarketView {
  id: MarketId;
  symbol: string;
  asset_class: AssetClass;
  schedule: Schedule;
  margin_tiers: Tier[];
  spread_tiers: Tier[];
  price_rules: PriceRules;
  /** From V21, the futures contracts the market prices from, in roll order; absent for a market priced from spot quotes. */
  contracts?: FuturesContract[];
  /** Unless USD, the quote currency and the FX market whose index converts it; absent for USD listings. */
  quote_currency?: { currency: "eur" | "gbp" | "jpy"; fx_market: MarketId };
  max_slippage_bps: number;
  house_cap_bps: number;
  /** From V6, the least the market cap may be, in USD notional; absent on the wire when zero (`engine_core::market::MarketSpec`). */
  house_cap_floor?: string;
  min_order_notional: string;
  open: boolean;
  reduce_only: boolean;
  mark: string | null;
  /** The FX index a market quoted in another currency is valued at; null or absent for USD markets and before its first price. */
  fx_mark?: string | null;
  stress_level: number;
}

/** `GET /v1/house`. */
export interface HouseView extends HouseScanView {
  cash: string;
  nav: string;
  gross_exposure: string;
}

export interface Position {
  qty: string;
  entry: string;
}

/** Tagged by `kind`, as the engine serializes it. */
export type OrderKind =
  | { kind: "market"; quoted: string; max_slippage_bps?: number }
  | { kind: "limit"; price: string }
  | { kind: "stop"; price: string };

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

/** `POST /v1/session-keys`: the account's authorization of `session_key` to trade until `expires_at` (Unix ms). */
export interface SessionKeyRequest {
  account: Address;
  session_key: Address;
  expires_at: number;
  auth: RequestAuth;
}

/** `DELETE /v1/session-keys`: the account's revocation of `session_key`. */
export interface SessionKeyRevocationRequest {
  account: Address;
  session_key: Address;
  auth: RequestAuth;
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

/** Tagged by `kind`, as the engine serializes it. */
export type Reject =
  | { kind: "access"; reason: AccessReject }
  | { kind: "market_closed" }
  | { kind: "reduce_only" }
  | { kind: "no_price" }
  | { kind: "unknown_market" }
  | { kind: "unknown_order" }
  | { kind: "invalid_order"; reason: string }
  | { kind: "invalid_amount" }
  | { kind: "slippage"; quoted: string; live: string; slippage_bps: number }
  | { kind: "insufficient_margin"; equity: string; required: string }
  | { kind: "insufficient_funds"; available: string }
  | { kind: "house_capacity" }
  | { kind: "invalid_signature" }
  | { kind: "missing_signature" }
  | { kind: "invalid_nonce"; expected: number }
  | { kind: "payout_unavailable" }
  | { kind: "session_key_scope" }
  | { kind: "invalid_session_key" }
  | { kind: "session_key_unsupported" }
  | { kind: "expired"; expires_at: number }
  | { kind: "expiry_too_far"; latest: number }
  | { kind: "too_many_session_keys"; max: number }
  /** A cancel-all or close-all sequenced before the node's protocol reached V44; it used no nonce. */
  | { kind: "batch_unsupported" };

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

/** The listing fields of an `AdminCommand::UpsertMarket` as the log serializes them; the optional ones are absent in entries older than the fields. */
export interface UpsertMarket {
  id?: MarketId;
  price_rules?: PriceRules;
  schedule?: Schedule;
  /** From V21; a non-empty list prices the market from futures. */
  contracts?: FuturesContract[];
  asset_class?: string;
  /** Unless USD, the quote currency, which makes the market FX-dependent. */
  quote_currency?: { currency: "eur" | "gbp" | "jpy"; fx_market: MarketId };
}

export interface SourceQuote {
  source: string;
  mid: string;
  ts: number;
  /** From V21, the futures contract quoted; absent for a spot market's quotes. */
  contract?: string;
}

/** A sequenced command, tagged by `type` as the engine's `Command` is; only the ones the console reads. */
export type EngineCommand =
  | { type: "prices"; market: MarketId; quotes: SourceQuote[] }
  | { type: "tick" }
  | ({ type: "admin"; action?: string } & UpsertMarket)
  | { type: "signed_admin"; command?: { action?: string } & UpsertMarket }
  | { type: "place_order" | "cancel_order" | "cancel_all" | "close_all" | "withdraw" | "deposit" | "attest_eligibility" | "register_session_key" | "revoke_session_key" };

/** The `set_params` fields of an `AdminCommand::SetParams` as the log serializes them, flat beside `action`. */
export interface SetParams {
  profit_fee_bps: number;
  closeout_level_bps: number;
  house_total_cap_bps: number;
  /** The total cap's dollar floor, a decimal string as every `Fixed` on the wire. */
  house_total_cap_floor: string;
}

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

/** An account event with where it sits in the log: `cursor` is `<seq>:<index>`, as the node serializes it. */
export type HistoryEvent = EngineEvent & { cursor: string; ts: number };

/** `GET /v1/accounts/{address}/history`, newest first; `next` is the `before` of the next page. */
export interface HistoryPage {
  events: HistoryEvent[];
  next: string | null;
}

export type { CancelAllRequest, CloseAllRequest, CloseEntry } from "./batch-types";
export type { PayoutEntry, PayoutsPage, QueuedWithdrawal, SignedWithdrawal, WithdrawalAuthorization, WithdrawalPage } from "./withdrawal-types";

/** One step of an executable quote: the average price of an order of up to `qty`. */
export interface QuoteStep {
  qty: string;
  price: string;
  /** Why a fill of this size would be declined; absent when it fills. */
  declined?: Reject;
}

/** One account's executable quotes in one market, as the signed stream's `quotes` op delivers them. */
export interface MarketQuote {
  type: "quote";
  account: Address;
  market: MarketId;
  open: boolean;
  reduce_only: boolean;
  stress_level: number;
  mark: string | null;
  /** Why the market has no price now; the sides are then empty. */
  unavailable?: Reject;
  /** What a buy pays, by size. */
  ask: QuoteStep[];
  /** What a sell receives, by size. */
  bid: QuoteStep[];
  /** The price of closing the account's whole position, if it holds one. */
  close: { side: Side; qty: string; price: string } | null;
}

