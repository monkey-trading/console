/** Closes out accounts whose equity has fallen below the close-out share of their margin. */

import { bpsOf, fixedToWire } from "../fixed";
import type { EngineEvent } from "../engine/types";
import { equityOf, marginOf } from "./accounts";
import { fillEvents, fillOrder } from "./execute";
import { CLOSE_OUT_BPS } from "../pricing";
import type { MockState } from "./state";

/** Liquidates every position of each account below the threshold, cancels its orders, and logs it. */
export function closeOutUnderwater(state: MockState): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const [address, account] of state.accounts) {
    if (account.positions.size === 0) continue;
    const equity = equityOf(state, account);
    const margin = marginOf(state, account);
    if (equity >= bpsOf(margin, CLOSE_OUT_BPS)) continue;
    events.push({ type: "close_out", account: address, equity: fixedToWire(equity), margin: fixedToWire(margin) });
    for (const [id, held] of [...account.positions]) {
      const outcome = fillOrder(state, {
        address, market: id, side: held.qty > 0n ? "sell" : "buy", qty: held.qty < 0n ? -held.qty : held.qty,
        reduceOnly: true, orderId: 0, liquidation: true,
      });
      if (outcome.ok) events.push(...fillEvents(outcome.fill));
    }
    for (const order of [...account.orders.values()]) {
      account.orders.delete(order.order_id);
      events.push({ type: "order_cancelled", account: address, order_id: order.order_id, reason: "unfillable" });
    }
  }
  return events;
}
