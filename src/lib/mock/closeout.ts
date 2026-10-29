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
 */
export function closeOutUnderwater(state: MockState): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const [address, account] of state.accounts) {
    // The close-out is announced with its first fill, so an account whose positions cannot trade says nothing until they can.
    let announced = false;
    const triggering = { equity: equityOf(state, account), margin: marginOf(state, account) };
    while (underwater(state, account)) {
      const id = worstTradable(state, account);
      const held = id === null ? undefined : account.positions.get(id);
      if (id === null || !held) break;
      const outcome = fillOrder(state, {
        address, market: id, side: held.qty > 0n ? "sell" : "buy", qty: absFixed(held.qty), reduceOnly: true, orderId: 0, liquidation: true,
      });
      if (!outcome.ok) break;
      if (!announced) {
        announced = true;
        events.push({ type: "close_out", account: address, equity: fixedToWire(triggering.equity), margin: fixedToWire(triggering.margin) });
      }
      events.push(...fillEvents(outcome.fill, outcome.badDebt));
    }
  }
  return events;
}
