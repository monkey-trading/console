/** Closes out accounts whose equity has fallen below the close-out share of their margin. */

import { absFixed, bpsOf, fixedToWire, mulFixed, type Fixed } from "../fixed";
import type { EngineEvent, MarketId } from "../engine/types";
import { equityOf, marginOf } from "./accounts";
import { fillEvents, fillOrder } from "./execute";
import { CLOSE_OUT_BPS } from "../pricing";
import type { AccountState, MockState } from "./state";

const underwater = (state: MockState, account: AccountState): boolean =>
  account.positions.size > 0 && equityOf(state, account) < bpsOf(marginOf(state, account), CLOSE_OUT_BPS);

/** The open market holding the account's largest unrealised loss, or null when none can trade. */
function worstTradable(state: MockState, account: AccountState): MarketId | null {
  let worst: { id: MarketId; pnl: Fixed } | null = null;
  for (const [id, held] of account.positions) {
    const market = state.markets.get(id);
    if (!market || !market.open || market.halted) continue;
    const pnl = mulFixed(held.qty, market.mid - held.entry);
    if (worst === null || pnl < worst.pnl) worst = { id, pnl };
  }
  return worst?.id ?? null;
}

/**
 * For each account below the threshold, closes its largest tradable loser, re-checks its health,
 * and repeats until it is healthy or nothing it holds can trade; positions in a closed market wait.
 * A closed position's resting orders are cancelled.
 */
export function closeOutUnderwater(state: MockState): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const [address, account] of state.accounts) {
    if (!underwater(state, account)) continue;
    events.push({
      type: "close_out", account: address, equity: fixedToWire(equityOf(state, account)), margin: fixedToWire(marginOf(state, account)),
    });
    while (underwater(state, account)) {
      const id = worstTradable(state, account);
      const held = id === null ? undefined : account.positions.get(id);
      if (id === null || !held) break;
      const outcome = fillOrder(state, {
        address, market: id, side: held.qty > 0n ? "sell" : "buy", qty: absFixed(held.qty), reduceOnly: true, orderId: 0, liquidation: true,
      });
      if (!outcome.ok) break;
      events.push(...fillEvents(outcome.fill, outcome.badDebt));
      for (const order of [...account.orders.values()]) {
        if (order.market !== id) continue;
        account.orders.delete(order.order_id);
        events.push({ type: "order_cancelled", account: address, order_id: order.order_id, reason: "unfillable" });
      }
    }
  }
  return events;
}
