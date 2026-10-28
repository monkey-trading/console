/** The signed order, cancel and eligibility actions, as the node sequences them. */

import { EngineError, type ActionResult } from "../engine/client";
import type { CancelRequest, EligibilityRequest, EngineEvent, OrderRequest, RequestAuth, Reject } from "../engine/types";
import { parseFixed } from "../fixed";
import { fillEvents, fillOrder, liveQuote } from "./execute";
import type { AccountState, MockState } from "./state";

/** Most limit and stop orders an account may rest. */
export const MAX_RESTING = 10;

/**
 * Refuses a caller from a region the node does not serve, as its real-peer screening does.
 * Error cases:
 * - the caller is in the United States or a sanctioned jurisdiction (403)
 */
export function checkAccess(state: MockState): void {
  if (state.region === "united_states") throw new EngineError(403, "not available to persons in the United States", { type: "access", reason: "united_states" });
  if (state.region === "sanctioned_jurisdiction") {
    throw new EngineError(403, "not available in sanctioned jurisdictions", { type: "access", reason: "sanctioned_jurisdiction" });
  }
}

/**
 * Checks a request's signature fields and consumes its nonce.
 * Error cases:
 * - no signature (401), an unsigned-looking signature (401), an expired request (400), or a nonce other than the next (409)
 */
export function checkAuth(state: MockState, account: AccountState, auth: RequestAuth | undefined): void {
  if (!auth) throw new EngineError(401, "missing signature", { type: "missing_signature" });
  if (!/^0x[0-9a-f]{130}$/i.test(auth.signature)) throw new EngineError(401, "invalid signature", { type: "invalid_signature" });
  if (auth.expires_at <= state.now) throw new EngineError(400, "request expired");
  if (auth.nonce !== account.nextNonce) throw new EngineError(409, "invalid nonce", { type: "invalid_nonce", expected: account.nextNonce });
  account.nextNonce += 1;
}

function rejected(req: OrderRequest, reason: Reject): EngineEvent[] {
  return [{ type: "order_rejected", account: req.account, client_id: req.client_id, reason }];
}

/** Sequences an order: a market order fills now or is refused; a limit or stop order rests. */
export function placeOrder(state: MockState, req: OrderRequest): ActionResult {
  checkAccess(state);
  const account = state.account(req.account);
  if (account.eligibility === null) throw new EngineError(403, "eligibility attestation required", { type: "access", reason: "eligibility_required" });
  checkAuth(state, account, req.auth);
  const events = orderEvents(state, req, account);
  return { seq: state.emit({ type: "place_order" }, events).seq, events };
}

function orderEvents(state: MockState, req: OrderRequest, account: AccountState): EngineEvent[] {
  const qty = parseFixed(req.qty);
  if (qty === null || qty <= 0n) return rejected(req, { type: "invalid_amount" });
  const runtime = state.markets.get(req.market);
  if (!runtime) return rejected(req, { type: "unknown_market" });
  const orderId = state.nextOrderId++;
  const accepted: EngineEvent = { type: "order_accepted", account: req.account, client_id: req.client_id, order_id: orderId };
  if (req.kind.type === "market") {
    const quoted = parseFixed(req.kind.quoted);
    if (quoted === null || quoted <= 0n) return rejected(req, { type: "invalid_order", reason: "quoted price" });
    const outcome = fillOrder(state, {
      address: req.account, market: req.market, side: req.side, qty, reduceOnly: req.reduce_only ?? false, orderId,
      slippage: { quoted, maxBps: req.kind.max_slippage_bps ?? runtime.listed.spec.max_slippage_bps },
    });
    return outcome.ok ? [accepted, ...fillEvents(outcome.fill)] : rejected(req, outcome.reject);
  }
  const price = parseFixed(req.kind.price);
  if (price === null || price <= 0n) return rejected(req, { type: "invalid_order", reason: "trigger price" });
  if (account.orders.size >= MAX_RESTING) return rejected(req, { type: "invalid_order", reason: `at most ${MAX_RESTING} resting orders` });
  if (!runtime.open || runtime.halted) return rejected(req, { type: "market_closed" });
  account.orders.set(orderId, { order_id: orderId, client_id: req.client_id, market: req.market, side: req.side, qty: req.qty, kind: req.kind, reduce_only: req.reduce_only ?? false });
  return [accepted];
}

/** Sequences the cancel of a resting order. */
export function cancelOrder(state: MockState, req: CancelRequest): ActionResult {
  checkAccess(state);
  const account = state.account(req.account);
  checkAuth(state, account, req.auth);
  const events: EngineEvent[] = [];
  if (account.orders.delete(req.order_id)) events.push({ type: "order_cancelled", account: req.account, order_id: req.order_id, reason: "client" });
  else events.push({ type: "order_rejected", account: req.account, client_id: 0, reason: { type: "unknown_order" } });
  return { seq: state.emit({ type: "cancel_order" }, events).seq, events };
}

/** Records the account's eligibility declaration; the first one stands. */
export function attestEligibility(state: MockState, req: EligibilityRequest): ActionResult {
  checkAccess(state);
  const account = state.account(req.account);
  checkAuth(state, account, req.auth);
  if (account.eligibility !== null) throw new EngineError(409, "eligibility already attested", { type: "access", reason: "already_attested" });
  account.eligibility = req.class;
  const events: EngineEvent[] = [{ type: "eligibility_attested", account: req.account, class: req.class }];
  return { seq: state.emit({ type: "attest_eligibility" }, events).seq, events };
}

/** Fires every resting order whose trigger the live quote has reached. */
export function triggerResting(state: MockState): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const [address, account] of state.accounts) {
    for (const order of [...account.orders.values()]) {
      const qty = parseFixed(order.qty);
      const level = parseFixed(order.kind.type === "market" ? "0" : order.kind.price);
      const quote = qty === null ? null : liveQuote(state, address, order.market, order.side, qty);
      if (qty === null || level === null || !quote) continue;
      const buy = order.side === "buy";
      const hit = order.kind.type === "limit" ? (buy ? quote.price <= level : quote.price >= level) : buy ? quote.price >= level : quote.price <= level;
      if (!hit) continue;
      account.orders.delete(order.order_id);
      const outcome = fillOrder(state, { address, market: order.market, side: order.side, qty, reduceOnly: order.reduce_only, orderId: order.order_id });
      if (outcome.ok) events.push(...fillEvents(outcome.fill));
      else events.push({ type: "order_cancelled", account: address, order_id: order.order_id, reason: "unfillable" });
    }
  }
  return events;
}
