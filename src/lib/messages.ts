/** Plain-language text for what the engine refused or did. */

import type { EngineEvent, MarketId, Reject } from "./engine/types";
import { fixedFromWire, formatUsd } from "./fixed";

const usd = (wire: string) => formatUsd(fixedFromWire(wire));

/** One sentence for a typed refusal. */
export function describeReject(reject: Reject): string {
  switch (reject.type) {
    case "access":
      return reject.reason === "eligibility_required" ? "Attest your eligibility first." : "This account cannot use the service from here.";
    case "market_closed": return "The market is closed.";
    case "reduce_only": return "The market only accepts orders that reduce a position.";
    case "no_price": return "The market has no price right now.";
    case "unknown_market": return "Unknown market.";
    case "unknown_order": return "That order is no longer resting.";
    case "invalid_order": return `Invalid order: ${reject.reason}.`;
    case "invalid_amount": return "Enter an amount above zero.";
    case "slippage":
      return `The price moved ${reject.slippage_bps} bps against the quote you saw (${reject.quoted} to ${reject.live}), past your bound. Nothing filled.`;
    case "insufficient_margin": return `Not enough equity: you have ${usd(reject.equity)} and the account needs ${usd(reject.required)} of margin.`;
    case "insufficient_funds": return `You can withdraw up to ${usd(reject.available)} now.`;
    case "house_capacity": return "The house cannot take more in this market. Try a smaller size.";
    case "invalid_signature": return "The signature was not accepted.";
    case "missing_signature": return "The request was not signed.";
    case "invalid_nonce": return "The request was out of order. Try again.";
    case "payout_unavailable": return "The node cannot pay withdrawals yet.";
  }
}

/** A short line for the activity log, or null for an event the log does not show. */
export function describeEvent(event: EngineEvent, symbolOf: (id: MarketId) => string): string | null {
  switch (event.type) {
    case "financing": return `Financing ${fixedFromWire(event.amount) < 0n ? "charged" : "credited"}: ${usd(event.amount)} on ${symbolOf(event.market)}`;
    case "market_opened": return `${symbolOf(event.market)} opened`;
    case "market_closed": return `${symbolOf(event.market)} closed`;
    case "stress_changed": return `${symbolOf(event.market)} stress level ${event.level}`;
    case "fill":
      return `${event.liquidation ? "Close-out " : ""}${event.side} ${event.qty} ${symbolOf(event.market)} at ${event.price}`;
    case "close_out": return "Account closed out";
    case "deposited": return `Deposit credited: ${usd(event.amount)}`;
    case "withdrawal_approved": return `Withdrawal approved: ${usd(event.amount)}`;
    case "withdrawal_queued": return `Withdrawal queued: ${usd(event.amount)}`;
    case "withdrawal_queue_updated": return `Queue updated, ${usd(event.remaining)} remaining`;
    case "eligibility_attested": return `Eligibility attested (${event.class.replace("_", " ")})`;
    case "order_cancelled": return `Order ${event.order_id} cancelled`;
    case "order_rejected": return `Order refused: ${describeReject(event.reason)}`;
    case "withdrawal_rejected": return `Withdrawal refused: ${describeReject(event.reason)}`;
    case "order_accepted": return null;
  }
}
