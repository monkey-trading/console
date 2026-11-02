/** The events the console reads from the log, tagged by `type` as the engine's `Event` is (`engine_core::event`). */

import type { Address, EligibilityClass, Fill, MarketId, OrderId, Reject } from "./types";

/** The events the console reads from the log, tagged by `type`. */
export type EngineEvent =
  | { type: "eligibility_attested"; account: Address; class: EligibilityClass }
  | { type: "deposited"; account: Address; amount: string }
  /** A vault deposit's custody step (adopted, finalised, or credited by a screening retry): the receipt names who it is for, and there is no `account` field. */
  | { type: "custody_deposit_changed"; receipt: { beneficiary: { kind: "trader"; account: Address } | { kind: "house" } } }
  /** A screened vault deposit waiting on, or held by, the access source. A deposit for the house has no account, so `account` is null: it is nobody's. `reason` is the engine's snake-case `AccessReject`. */
  | { type: "deposit_pending" | "deposit_held"; chain_ref: string; account: Address | null; payer: Address | null; amount: string; reason: string }
  | { type: "order_accepted"; account: Address; client_id: number; order_id: OrderId }
  | { type: "order_rejected"; account: Address; client_id: number; reason: Reject }
  | { type: "order_cancelled"; account: Address; order_id: OrderId; reason: "client" | "unfillable" }
  | ({ type: "fill" } & Fill)
  | { type: "close_out"; account: Address; equity: string; margin: string }
  | { type: "withdrawal_approved"; account: Address; amount: string; nonce: number }
  | { type: "withdrawal_queued"; account: Address; amount: string; requested_seq: number }
  | { type: "withdrawal_queue_updated"; account: Address; requested_seq: number; remaining: string }
  | { type: "withdrawal_rejected"; account: Address; amount: string; reason: Reject }
  | { type: "emission_allocated"; account: Address; period: number; weight: string; amount: string }
  | { type: "emission_period_closed"; period: number; budget: string; allocated: string; cancelled: string }
  | { type: "financing"; account: Address; market: MarketId; amount: string }
  | { type: "bad_debt"; account: Address; amount: string }
  /** Signed USD realised by closing the fraction a split rounded off a position; counts toward emission weight like a fill's result. */
  | { type: "corporate_cash_in_lieu"; id: string; market: MarketId; account: Address; amount: string }
  | { type: "eligibility_rejected"; account: Address; reason: Reject }
  | { type: "prices_rejected"; market: MarketId; reason: string }
  | { type: "market_opened"; market: MarketId }
  | { type: "market_closed"; market: MarketId }
  | { type: "stress_changed"; market: MarketId; level: number }
  | { type: "session_key_registered"; account: Address; session_key: Address; expires_at: number }
  | { type: "session_key_revoked"; account: Address; session_key: Address }
  | { type: "session_key_rejected"; account: Address; session_key: Address; reason: Reject }
  /** The operator registry turned rotation on or off, mirrored. */
  | { type: "rotation_switched"; enabled: boolean; election_cancelled: boolean }
  /** An election the operator registry made, mirrored; `admin_key` signs admin commands from `effective_at`. */
  | { type: "operator_elected"; epoch: number; candidate: Address; admin_key: Address; effective_at: number }
  | { type: "admin_applied" }
  | { type: "admin_rejected"; reason: string };
