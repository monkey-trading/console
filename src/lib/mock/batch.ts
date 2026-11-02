/**
 * The batch forms of the engine's V44: cancel every resting order, or close whole positions, on one
 * signed request and one nonce (`crates/core/src/execution/{cancel,batch}.rs`).
 */

import { EngineError, type ActionResult } from "../engine/client";
import type { CancelAllRequest, CloseAllRequest, EngineEvent, Reject } from "../engine/types";
import { absFixed, fixedToWire } from "../fixed";
import { checkAccess, identifySigner, orderEvents } from "./orders";
import type { MockState } from "./state";

/** A refusal of the whole request: a lone rejection with `client_id` 0, as the engine logs it. */
const refusal = (account: string, reason: Reject): EngineEvent[] => [{ type: "order_rejected", account, client_id: 0, reason }];

/** Cancels every resting order the account holds, in order id order, each as a single cancel reports it; none resting is no events. */
export function cancelAll(state: MockState, req: CancelAllRequest): ActionResult {
  // As a single cancel: authenticated, not screened.
  const account = state.account(req.account);
  identifySigner(state, req.account, account, req.auth);
  const events: EngineEvent[] = [];
  for (const orderId of [...account.orders.keys()].sort((a, b) => a - b)) {
    account.orders.delete(orderId);
    events.push({ type: "order_cancelled", account: req.account, order_id: orderId, reason: "client" });
  }
  return { seq: state.emit({ type: "cancel_all" }, events).seq, events };
}

/**
 * Closes the account's whole position in each listed market as a reduce-only market order, in list
 * order, each seeing what the one before left; an entry that cannot fill is rejected with its list
 * index as `client_id` and the rest still run.
 * Error cases:
 * - more entries than listed markets (400, before the signature is checked, so no nonce is spent)
 * - as a single order: a region the node does not serve (403) or no eligibility attestation (403)
 * - a signature, expiry or nonce the request fails (401, 400, 409)
 * Refused whole, with a lone `order_rejected` (the nonce spent): no entries, or a market named twice.
 */
export function closeAll(state: MockState, req: CloseAllRequest): ActionResult {
  if (req.closes.length > state.markets.size) throw new EngineError(400, "more closes than listed markets");
  checkAccess(state);
  const account = state.account(req.account);
  if (account.eligibility === null) throw new EngineError(403, "eligibility attestation required", { kind: "access", reason: "eligibility_required" });
  identifySigner(state, req.account, account, req.auth);
  const markets = req.closes.map((entry) => entry.market);
  const reason = markets.length === 0 ? "no markets to close" : new Set(markets).size < markets.length ? "market named twice" : null;
  const events: EngineEvent[] = reason === null ? [] : refusal(req.account, { kind: "invalid_order", reason });
  if (reason === null) {
    req.closes.forEach((entry, index) => {
      const held = account.positions.get(entry.market)?.qty ?? 0n;
      // With no position the engine sends the smallest sell, which a reduce-only order refuses.
      const closing = { side: held >= 0n ? "sell" : "buy", qty: held === 0n ? "0.000000001" : fixedToWire(absFixed(held)) } as const;
      const kind = { kind: "market", quoted: entry.quoted, ...(req.max_slippage_bps === undefined ? {} : { max_slippage_bps: req.max_slippage_bps }) } as const;
      events.push(...orderEvents(state, { account: req.account, client_id: index, market: entry.market, ...closing, kind, reduce_only: true }, account));
    });
  }
  return { seq: state.emit({ type: "close_all" }, events).seq, events };
}
