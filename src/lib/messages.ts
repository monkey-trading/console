/** Plain-language text for what the engine refused or did. */

import type { TierRateLimit } from "./engine/client";
import { MAX_SESSION_KEYS_PER_ACCOUNT } from "./engine/session-key-limits";
import type { EngineEvent, MarketId, Reject } from "./engine/types";
import { formatHold } from "./fee-words";
import { absFixed, fixedFromWire, formatFixedPlaces, formatUsd } from "./fixed";
import { formatMonkey, formatRate } from "./format";
import { describeLevelEvent, describeLevelReject } from "./level-words";
import { formatTenthBps, tenthBpsOfValue } from "./spread-bands";
import { noPriceRefusal } from "./unpriced";

/** An engine decimal with at most `places` places, grouped in thousands. */
function decimals(wire: string, places: number): string {
  const text = formatFixedPlaces(fixedFromWire(wire), places);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

const usd = (wire: string) => formatUsd(fixedFromWire(wire));

/** What the console says when it accepts a mock attestation: the in-browser simulation, or a development node it did not verify. */
export function describeMockAttestation(signatures: "checked" | "none"): { lead: string; rest: string } {
  return signatures === "none"
    ? { lead: "Demo mode.", rest: "This is a simulation running in your browser. Prices, trades and funds are not real." }
    : { lead: "Test server.", rest: "This server cannot be verified, so it is suitable for testing only. Prices, trades and funds are not real." };
}

/** What the banner says while the node is verified again: only what the client does. */
export function describeReverifying(): { lead: string; rest: string } {
  return {
    lead: "Verifying the server again.",
    rest: "The trading server could not be verified, so trading has been suspended until verification succeeds. The prices shown are the last verified prices.",
  };
}

/** One sentence for a typed refusal. */
export function describeReject(reject: Reject): string {
  switch (reject.kind) {
    case "access":
      return reject.reason === "eligibility_required" ? "Your eligibility has not been declared. Sign the eligibility declaration to continue." : reject.reason === "already_attested" ? "Your eligibility declaration has already been recorded." : "This service is not available in your region.";
    case "market_closed": return "This market is closed.";
    case "reduce_only": return "This market is currently accepting only orders that reduce an existing position.";
    case "no_price": return noPriceRefusal(undefined);
    case "unknown_market": return "This market is not listed.";
    case "unknown_order": return "This order is no longer working. It may already have been filled or cancelled.";
    case "invalid_order": return describeInvalidOrder(reject.reason);
    case "invalid_amount": return "Enter an amount above zero.";
    case "slippage":
      return `Your order was not filled. The price moved ${reject.slippage_bps} bps against you, from ${decimals(reject.quoted, 5)} to ${decimals(reject.live, 5)}, which is more than your maximum slippage allows. Please try again at the current price.`;
    case "insufficient_margin": return `Insufficient margin. This order requires ${usd(reject.required)} of margin, and your equity is ${usd(reject.equity)}.`;
    case "weekend_margin": return `Insufficient margin. The higher weekend margin applies in this market, so this order requires ${usd(reject.required)} of margin, and your equity is ${usd(reject.equity)}.`;
    case "insufficient_funds": return `Insufficient funds. You can withdraw up to ${usd(reject.available)} at the moment.`;
    case "house_capacity": return "The house has reached its exposure limit in this market. Please try a smaller order size.";
    case "too_many_orders": return `Working order limit reached. Your account can have up to ${reject.max} working orders at a time. Cancel a working order to place a new one.`;
    case "tier_order_limit": return `Working order limit reached. Volume tier ${reject.tier} allows up to ${reject.max} working orders at a time. Cancel a working order to place a new one, or trade more to reach a higher tier.`;
    case "close_spread_ceiling": return `This order cannot reverse the position in a single trade, because its spread would exceed the market's maximum closing spread of ${reject.ceiling_bps} bps. Close the position first, then open a new position on the other side.`;
    case "invalid_signature": return "The request's signature was not accepted. Try again.";
    case "missing_signature": return "The request was not signed. Sign the request and try again.";
    case "invalid_nonce": return "Another request from your account was processed first, so this request was not accepted. Check your orders and positions, then try again.";
    case "payout_unavailable": return "Withdrawals cannot be processed at the moment, and your balance has not been debited. Try again later.";
    case "session_key_scope": return "This browser's session key can only place and cancel orders and cannot move funds. Sign this request with your wallet instead.";
    case "invalid_session_key": return "The server did not accept this browser's session key.";
    case "session_key_unsupported": return "This server does not support session keys yet.";
    case "expired": return "The request expired before it reached the server. Try again.";
    case "expiry_too_far": return "The request was rejected because its expiry time was too far ahead of the server's time. Check that your device clock is correct, then try again.";
    case "too_many_session_keys": return reject.max === MAX_SESSION_KEYS_PER_ACCOUNT ? "This account already has the maximum number of session keys." : "This account has added too many session keys in a short time. One more can be added each hour.";
    case "batch_unsupported": return "This server does not yet support cancelling or closing everything in a single request.";
    case "level_too_close":
    case "levels_unsupported": return describeLevelReject(reject);
  }
  // A refusal the engine adds later must get a case above; until then the user still sees that one happened.
  return unnamed(reject);
}

/**
 * An invalid order's reason as a sentence: the engine's reasons for the minimum, for a spread that reaches the price, and for
 * a size or price outside its input range in plain words (`execution/mod.rs`, `execution/validation.rs`), and any other as the
 * node words it, as a sentence of its own.
 */
function describeInvalidOrder(reason: string): string {
  if (reason.startsWith("below minimum order notional") || reason.startsWith("below the minimum order")) return "This order is below the market's minimum order value.";
  if (reason === "spread at this size reaches the price") return "This order is too large to be priced. Please try a smaller order size.";
  if (reason === "qty out of range") return "The order size is outside the range the server accepts.";
  if (reason === "price out of range") return "The order price is outside the range the server accepts.";
  // The engine's reasons for a take profit or stop loss it cannot take (`levels/request.rs`).
  if (reason === "level out of range") return "The take profit or stop loss is outside the range of prices the server accepts.";
  if (reason === "no position to set levels on") return "You no longer hold a position in this market, so a take profit or stop loss cannot be set on it.";
  if (reason === "no price to measure levels from") return "No price is available for this market, so the take profit and stop loss cannot be checked. Please try again once prices are updating.";
  if (reason === "a reduce-only order names no levels") return "An order that only reduces a position cannot set a take profit or stop loss.";
  if (reason === "the market names no minimum level distance") return "This market does not accept take-profit and stop-loss levels.";
  return `This order cannot be placed. ${reason.charAt(0).toUpperCase()}${reason.slice(1).replace(/\.$/, "")}.`;
}

/** What a 429 that names the account's volume tier says: how fast it may send, and that nothing was recorded. */
export function describeTierRate(limit: TierRateLimit): string {
  return `Your request was not processed. You are sending requests faster than volume tier ${limit.tier} allows, which is ${limit.requestsPerSecond} per second. Wait a moment and try again.`;
}

/** A short line for the activity log, or null for an event the log does not show. */
export function describeEvent(event: EngineEvent, symbolOf: (id: MarketId) => string): string | null {
  switch (event.type) {
    // The engine's sign: a positive amount is what the account pays.
    case "financing": return `Financing ${fixedFromWire(event.amount) > 0n ? "charged" : "credited"}: ${usd(event.amount.replace("-", ""))} on ${symbolOf(event.market)}`;
    case "bad_debt": return `Loss in excess of your balance written off: ${usd(event.amount)}`;
    case "eligibility_rejected": return `Eligibility rejected: ${describeReject(event.reason)}`;
    case "market_opened": return `${symbolOf(event.market)} market opened`;
    case "market_closed": return `${symbolOf(event.market)} market closed`;
    case "stress_changed": return `${symbolOf(event.market)} stress level changed to ${event.level}`;
    case "fill": {
      // The spread paid exactly, in tenths of a bp of the index: `spread_bps` truncates to whole bps.
      const index = fixedFromWire(event.index);
      const spread = formatTenthBps(tenthBpsOfValue(absFixed(fixedFromWire(event.price) - index), index));
      const closed = event.hold_ms === undefined || event.profit_fee_bps === undefined ? "" : `, held ${formatHold(event.hold_ms)}, profit fee ${formatRate(event.profit_fee_bps)}`;
      return `${event.liquidation ? "Close-out: " : ""}${event.side === "buy" ? "Bought" : "Sold"} ${decimals(event.qty, 6)} ${symbolOf(event.market)} at ${decimals(event.price, 5)} (spread ${spread}${closed})`;
    }
    case "close_out": return "Account closed out";
    case "deposited": return `Deposit credited: ${usd(event.amount)}`;
    case "withdrawal_approved": return `Withdrawal approved: ${usd(event.amount)}`;
    case "withdrawal_queued": return `Withdrawal queued: ${usd(event.amount)}`;
    case "withdrawal_queue_updated": return `Withdrawal queue updated: ${usd(event.remaining)} still to be paid`;
    case "eligibility_attested": return `Eligibility declared (${event.class.replace("_", " ")})`;
    case "order_cancelled": return event.reason === "client" ? `Order ${event.order_id} cancelled` : `Order ${event.order_id} could not be filled and was cancelled`;
    case "order_rejected": return `Order rejected: ${describeReject(event.reason)}`;
    case "withdrawal_rejected": return `Withdrawal rejected: ${describeReject(event.reason)}`;
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
    case "position_levels_set":
    case "position_level_triggered":
    case "position_levels_removed": return describeLevelEvent(event, symbolOf);
  }
  // Events the engine adds later stay out of the log until they get a case above.
  return unnamedEvent(event);
}

/** The text for a refusal the switch above does not name. `never` makes a new member of `Reject` a type error there. */
function unnamed(reject: never): string {
  void reject;
  return "The server rejected the request.";
}

/** The log line for an event the switch above does not name; see `unnamed`. */
function unnamedEvent(event: never): null {
  void event;
  return null;
}
