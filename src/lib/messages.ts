/** Plain-language text for what the engine refused or did. */

import type { EngineEvent, MarketId, Reject } from "./engine/types";
import { fixedFromWire, formatFixedPlaces, formatUsd } from "./fixed";
import { formatMonkey } from "./format";

/** An engine decimal with at most `places` places, grouped in thousands. */
function decimals(wire: string, places: number): string {
  const text = formatFixedPlaces(fixedFromWire(wire), places);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

const usd = (wire: string) => formatUsd(fixedFromWire(wire));

/** What the console says when it accepts a mock attestation: the in-browser simulation, or a development node it did not verify. */
export function describeMockAttestation(signatures: "checked" | "none"): { lead: string; rest: string } {
  return signatures === "none"
    ? { lead: "Mock attestation accepted.", rest: "Simulated node in your browser, not an enclave: prices, fills and funds are not real." }
    : { lead: "Mock attestation accepted.", rest: "A development node whose attestation proves no enclave, read through the verifier's dev-only mock entry point: prices, fills and funds are not real." };
}

/** What the banner says while the node is verified again: only what the client does. */
export function describeReverifying(): { lead: string; rest: string } {
  return {
    lead: "Re-verifying the node.",
    rest: "The enclave changed or an answer failed its check. Reads wait and signing is paused until it passes; the stream keeps showing the frames it has already verified.",
  };
}

/** One sentence for a typed refusal. */
export function describeReject(reject: Reject): string {
  switch (reject.kind) {
    case "access":
      return reject.reason === "eligibility_required" ? "Attest your eligibility first." : reject.reason === "already_attested" ? "Your eligibility is already recorded." : "This account cannot use the service from here.";
    case "market_closed": return "The market is closed.";
    case "reduce_only": return "The market only accepts orders that reduce a position.";
    case "no_price": return "The market has no price right now.";
    case "unknown_market": return "Unknown market.";
    case "unknown_order": return "That order is no longer resting.";
    case "invalid_order": return `Invalid order: ${reject.reason}.`;
    case "invalid_amount": return "Enter an amount above zero.";
    case "slippage":
      return `The price moved ${reject.slippage_bps} bps against the quote you saw (${decimals(reject.quoted, 5)} to ${decimals(reject.live, 5)}), past your bound. Nothing filled.`;
    case "insufficient_margin": return `Not enough equity: you have ${usd(reject.equity)} and the account needs ${usd(reject.required)} of margin.`;
    case "insufficient_funds": return `You can withdraw up to ${usd(reject.available)} now.`;
    case "house_capacity": return "The house cannot take more in this market. Try a smaller size.";
    case "invalid_signature": return "The signature was not accepted.";
    case "missing_signature": return "The request was not signed.";
    case "invalid_nonce": return "The request was out of order. Try again.";
    case "payout_unavailable": return "The node cannot pay withdrawals yet.";
  }
  // A refusal the engine adds later must get a case above; until then the user still sees that one happened.
  return unnamed(reject);
}

/** A short line for the activity log, or null for an event the log does not show. */
export function describeEvent(event: EngineEvent, symbolOf: (id: MarketId) => string): string | null {
  switch (event.type) {
    // The engine's sign: a positive amount is what the account pays.
    case "financing": return `Financing ${fixedFromWire(event.amount) > 0n ? "charged" : "credited"}: ${usd(event.amount.replace("-", ""))} on ${symbolOf(event.market)}`;
    case "bad_debt": return `Loss beyond the balance written off: ${usd(event.amount)}`;
    case "eligibility_rejected": return `Eligibility refused: ${describeReject(event.reason)}`;
    case "market_opened": return `${symbolOf(event.market)} opened`;
    case "market_closed": return `${symbolOf(event.market)} closed`;
    case "stress_changed": return `${symbolOf(event.market)} stress level ${event.level}`;
    case "fill":
      return `${event.liquidation ? "Close-out " : ""}${event.side} ${decimals(event.qty, 6)} ${symbolOf(event.market)} at ${decimals(event.price, 5)}`;
    case "close_out": return "Account closed out";
    case "deposited": return `Deposit credited: ${usd(event.amount)}`;
    case "withdrawal_approved": return `Withdrawal approved: ${usd(event.amount)}`;
    case "withdrawal_queued": return `Withdrawal queued: ${usd(event.amount)}`;
    case "withdrawal_queue_updated": return `Queue updated, ${usd(event.remaining)} remaining`;
    case "eligibility_attested": return `Eligibility attested (${event.class.replace("_", " ")})`;
    case "order_cancelled": return event.reason === "client" ? `Order ${event.order_id} cancelled` : `Order ${event.order_id} could not fill and was cancelled`;
    case "order_rejected": return `Order refused: ${describeReject(event.reason)}`;
    case "withdrawal_rejected": return `Withdrawal refused: ${describeReject(event.reason)}`;
    case "emission_allocated": return `MONKEY allocated: ${formatMonkey(BigInt(event.amount))} (period ${event.period})`;
    // Period housekeeping names no account; the allocations above are the viewer's lines.
    case "emission_period_closed": return null;
    case "order_accepted": return null;
    case "prices_rejected": return null;
    // Operator housekeeping is not the viewer's activity.
    case "admin_applied": return null;
    case "admin_rejected": return null;
  }
  // Events the engine adds later stay out of the log until they get a case above.
  return unnamedEvent(event);
}

/** The text for a refusal the switch above does not name. `never` makes a new member of `Reject` a type error there. */
function unnamed(reject: never): string {
  void reject;
  return "The node refused the request.";
}

/** The log line for an event the switch above does not name; see `unnamed`. */
function unnamedEvent(event: never): null {
  void event;
  return null;
}
