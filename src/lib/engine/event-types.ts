/** The events the console reads from the log, tagged by `type` as the engine's `Event` is (`engine_core::event`). */

import type { Address, EligibilityClass, Fill, MarketId, OrderId, Reject } from "./types";

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
  | { type: "admin_applied" }
  | { type: "admin_rejected"; reason: string };
