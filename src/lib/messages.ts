/** Plain-language text for what the engine refused or did. */

import type { TierRateLimit } from "./engine/client";
import { MAX_SESSION_KEYS_PER_ACCOUNT } from "./engine/session-key-limits";
import type { EngineEvent, MarketId, Reject } from "./engine/types";
import { formatHold } from "./fee-words";
import { absFixed, fixedFromWire, formatFixedPlaces, formatUsd } from "./fixed";
import { formatMonkey, formatRate } from "./format";
import { formatTenthBps, tenthBpsOfValue } from "./spread-bands";

/** An engine decimal with at most `places` places, grouped in thousands. */
function decimals(wire: string, places: number): string {
  const text = formatFixedPlaces(fixedFromWire(wire), places);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

const usd = (wire: string) => formatUsd(fixedFromWire(wire));

/** What the console says when it accepts a mock attestation: the in-browser simulation, or a development node it did not verify. */
export function describeMockAttestation(signatures: "checked" | "none"): { lead: string; rest: string } {
  return signatures === "none"
    ? { lead: "Demo mode.", rest: "This is a simulation running in your browser. Prices, trades and funds aren't real." }
    : { lead: "Test server.", rest: "This server can't be verified, so it's for testing only. Prices, trades and funds aren't real." };
}

/** What the banner says while the node is verified again: only what the client does. */
export function describeReverifying(): { lead: string; rest: string } {
  return {
    lead: "Checking the server again.",
    rest: "The server couldn't be verified, so trading is paused until it is. Prices shown are the last verified ones.",
  };
}

/** One sentence for a typed refusal. */
export function describeReject(reject: Reject): string {
  switch (reject.kind) {
    case "access":
      return reject.reason === "eligibility_required" ? "Sign the eligibility declaration first." : reject.reason === "already_attested" ? "Your eligibility is already recorded." : "This service isn't available in your region.";
    case "market_closed": return "This market is closed.";
    case "reduce_only": return "This market only accepts orders that reduce a position.";
    case "no_price": return "This market has no price right now.";
    case "unknown_market": return "This market isn't listed.";
    case "unknown_order": return "That order is no longer open.";
    case "invalid_order": return describeInvalidOrder(reject.reason);
    case "invalid_amount": return "Enter an amount above zero.";
    case "slippage":
      return `The price moved ${reject.slippage_bps} bps against you (from ${decimals(reject.quoted, 5)} to ${decimals(reject.live, 5)}), more than your max slippage. Your order didn't fill.`;
    case "insufficient_margin": return `Not enough margin: your equity is ${usd(reject.equity)} and you need ${usd(reject.required)}.`;
    case "weekend_margin": return `Not enough margin while the higher weekend margin applies: your equity is ${usd(reject.equity)} and you need ${usd(reject.required)}.`;
    case "insufficient_funds": return `You can withdraw up to ${usd(reject.available)} now.`;
    case "house_capacity": return "This market is at its limit. Try a smaller size.";
    case "too_many_orders": return `You already have ${reject.max} open orders, the most allowed. Cancel one to place another.`;
    case "tier_order_limit": return `You already have ${reject.max} open orders, the most for volume tier ${reject.tier}. Cancel one to place another, or trade more to reach a higher tier.`;
    case "close_spread_ceiling": return `Reversing this position in one order would cost more than the ${reject.ceiling_bps} bps maximum spread. Close it first, then open the other side.`;
    case "invalid_signature": return "The signature wasn't accepted.";
    case "missing_signature": return "The request wasn't signed.";
    case "invalid_nonce": return "The request was out of order. Try again.";
    case "payout_unavailable": return "Withdrawals can't be paid yet.";
    case "session_key_scope": return "A session key can only trade, not move funds. Sign this with your wallet.";
    case "invalid_session_key": return "The server didn't accept this session key.";
    case "session_key_unsupported": return "This server doesn't support session keys yet.";
    case "expired": return "The request expired before it arrived. Try again.";
    case "expiry_too_far": return "The request's expiry was too far ahead.";
    case "too_many_session_keys": return reject.max === MAX_SESSION_KEYS_PER_ACCOUNT ? "This account already has the most session keys allowed." : "This account has added session keys too quickly. You can add one more each hour.";
    case "batch_unsupported": return "This server can't cancel or close everything in one go yet.";
  }
  // A refusal the engine adds later must get a case above; until then the user still sees that one happened.
  return unnamed(reject);
}

/**
 * An invalid order's reason as a sentence: the engine's reasons for the minimum and for a spread that reaches the price in
 * plain words (`execution/mod.rs`, `execution/validation.rs`), and any other as the node words it.
 */
function describeInvalidOrder(reason: string): string {
  if (reason.startsWith("below minimum order notional") || reason.startsWith("below the minimum order")) return "This order is below the market's minimum order size.";
  if (reason === "spread at this size reaches the price") return "This order is too large to price. Try a smaller size.";
  return `This order can't be placed: ${reason}.`;
}

/** What a 429 that names the account's volume tier says: how fast it may send, and that nothing was recorded. */
export function describeTierRate(limit: TierRateLimit): string {
  return `You're sending requests faster than volume tier ${limit.tier} allows, which is ${limit.requestsPerSecond} a second. Nothing was done. Wait a moment and try again.`;
}

/** A short line for the activity log, or null for an event the log does not show. */
export function describeEvent(event: EngineEvent, symbolOf: (id: MarketId) => string): string | null {
  switch (event.type) {
    // The engine's sign: a positive amount is what the account pays.
    case "financing": return `Financing ${fixedFromWire(event.amount) > 0n ? "charged" : "credited"}: ${usd(event.amount.replace("-", ""))} on ${symbolOf(event.market)}`;
    case "bad_debt": return `Loss beyond your balance written off: ${usd(event.amount)}`;
    case "eligibility_rejected": return `Eligibility refused: ${describeReject(event.reason)}`;
    case "market_opened": return `${symbolOf(event.market)} opened`;
    case "market_closed": return `${symbolOf(event.market)} closed`;
    case "stress_changed": return `${symbolOf(event.market)} stress level ${event.level}`;
    case "fill": {
      // The spread paid exactly, in tenths of a bp of the index: `spread_bps` truncates to whole bps.
      const index = fixedFromWire(event.index);
      const spread = formatTenthBps(tenthBpsOfValue(absFixed(fixedFromWire(event.price) - index), index));
      const closed = event.hold_ms === undefined || event.profit_fee_bps === undefined ? "" : `, held ${formatHold(event.hold_ms)}, fee ${formatRate(event.profit_fee_bps)} of profit`;
      return `${event.liquidation ? "Close-out " : ""}${event.side} ${decimals(event.qty, 6)} ${symbolOf(event.market)} at ${decimals(event.price, 5)} (spread ${spread}${closed})`;
    }
    case "close_out": return "Account closed out";
    case "deposited": return `Deposit credited: ${usd(event.amount)}`;
    case "withdrawal_approved": return `Withdrawal approved: ${usd(event.amount)}`;
    case "withdrawal_queued": return `Withdrawal queued: ${usd(event.amount)}`;
    case "withdrawal_queue_updated": return `Withdrawal queue updated: ${usd(event.remaining)} still to pay`;
    case "eligibility_attested": return `Eligibility declared (${event.class.replace("_", " ")})`;
    case "order_cancelled": return event.reason === "client" ? `Order ${event.order_id} cancelled` : `Order ${event.order_id} could not fill and was cancelled`;
    case "order_rejected": return `Order refused: ${describeReject(event.reason)}`;
    case "withdrawal_rejected": return `Withdrawal refused: ${describeReject(event.reason)}`;
    case "emission_allocated": return `MONKEY earned: ${formatMonkey(BigInt(event.amount))} (reward period ${event.period})`;
    // Period housekeeping names no account; the allocations above are the viewer's lines.
    case "emission_period_closed": return null;
    // The Staking page lists each epoch's distribution to the account; the log shows no line for it.
    case "distribution_allocated": return null;
    case "operator_share_allocated": return null;
    // Cash in lieu is a realised result: the P&L tab lists it, the activity log does not.
    case "corporate_cash_in_lieu": return null;
    case "order_accepted": return null;
    case "prices_rejected": return null;
    // Operator housekeeping is not the viewer's activity; the Staking page shows the election.
    case "admin_applied": return null;
    case "rotation_switched": return null;
    case "operator_elected": return null;
    case "rotation_set_adopted": return null;
    case "turn_assigned": return null;
    case "turn_refused": return null;
    case "turn_taken": return null;
    case "turn_taken_rejected": return null;
    // A vote's outcome is the Staking page's Governance tab's to show, not the viewer's activity.
    case "proposal_scheduled": return null;
    case "restriction_applied": return null;
    case "proposal_refused": return null;
    case "restriction_lapsed": return null;
    // The deposit's custody steps are not the viewer's activity; `deposited` is the credit's line.
    case "custody_deposit_changed": return null;
    // A screened deposit waiting or held is custody bookkeeping, and a house deposit names no account.
    case "deposit_pending": return null;
    case "deposit_held": return null;
    case "admin_rejected": return null;
    // The login step reports itself; the log shows no line for key bookkeeping.
    case "session_key_registered": return null;
    case "session_key_revoked": return null;
    case "session_key_rejected": return null;
  }
  // Events the engine adds later stay out of the log until they get a case above.
  return unnamedEvent(event);
}

/** The text for a refusal the switch above does not name. `never` makes a new member of `Reject` a type error there. */
function unnamed(reject: never): string {
  void reject;
  return "The server refused the request.";
}

/** The log line for an event the switch above does not name; see `unnamed`. */
function unnamedEvent(event: never): null {
  void event;
  return null;
}
