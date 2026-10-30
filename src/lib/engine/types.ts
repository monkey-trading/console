/**
 * The engine node's REST and stream shapes as the console uses them, field for field as
 * `crates/node/src/api` and `crates/core/src` serialize them: amounts are decimal strings,
 * identifiers numbers, and every enum is snake_case.
 */

import type { EngineEvent } from "./event-types";
export type { EngineEvent } from "./event-types";

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
  | { kind: "payout_unavailable" };

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
  | { type: "place_order" | "cancel_order" | "withdraw" | "deposit" | "attest_eligibility" };

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

/** An account event with where it sits in the log: `cursor` is `<seq>:<index>`, as the node serializes it. */
export type HistoryEvent = EngineEvent & { cursor: string; ts: number };

/** `GET /v1/accounts/{address}/history`, newest first; `next` is the `before` of the next page. */
export interface HistoryPage {
  events: HistoryEvent[];
  next: string | null;
}

/** The vault's EIP-712 authorization of an approved payout, with its proof against a checkpoint root. */
export interface WithdrawalAuthorization {
  signer: Address;
  signer_epoch: number;
  /** Unix seconds; the vault accepts it until `expires_at`, 24 hours later. */
  issued_at: number;
  expires_at: number;
  checkpoint_seq: number;
  checkpoint_root: string;
  siblings: string[];
}

/** A signed withdrawal as the stream carries it (`type: "withdrawal"`): what the account claims on the vault. */
export interface SignedWithdrawal {
  account: Address;
  amount: string;
  /** The payout nonce `withdrawal_approved` named. */
  nonce: number;
  chain_id: number;
  vault: Address;
  signature: string;
  approved_seq?: number;
  authorization?: WithdrawalAuthorization;
}

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

export type { MarkEntry, MarkPage, MarkProvenance, MarkResolution } from "./mark-types";
