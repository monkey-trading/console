/** An account's equity and margin at the current marks, and the house's exposure. */

import { absFixed, mulFixed, type Fixed } from "../fixed";
import { tieredMargin } from "../pricing";
import type { AccountState, MockState } from "./state";

/** Unrealised profit and loss of the account's positions at the index. */
export function unrealised(state: MockState, account: AccountState): Fixed {
  let total = 0n;
  for (const [id, held] of account.positions) {
    const market = state.markets.get(id);
    if (market) total += mulFixed(held.qty, market.mid - held.entry);
  }
  return total;
}

/** The account's initial margin over every position. */
export function marginOf(state: MockState, account: AccountState): Fixed {
  let total = 0n;
  for (const [id, held] of account.positions) {
    const market = state.markets.get(id);
    if (market) total += tieredMargin(market.listed.spec.margin_tiers, mulFixed(held.qty, market.mid));
  }
  return total;
}

export function equityOf(state: MockState, account: AccountState): Fixed {
  return account.balance + unrealised(state, account);
}

/** The house's net notional in a market: the opposite of every account's position. */
export function houseNetNotional(state: MockState, id: number): Fixed {
  const market = state.markets.get(id);
  if (!market) return 0n;
  let qty = 0n;
  for (const account of state.accounts.values()) qty -= account.positions.get(id)?.qty ?? 0n;
  return mulFixed(qty, market.mid);
}

/** The house's gross notional over every market. */
export function houseGross(state: MockState): Fixed {
  let total = 0n;
  for (const id of state.markets.keys()) total += absFixed(houseNetNotional(state, id));
  return total;
}

/** The house's net asset value: its cash less what accounts hold unrealised. */
export function houseNav(state: MockState): Fixed {
  let accountsPnl = 0n;
  for (const account of state.accounts.values()) accountsPnl += unrealised(state, account);
  return state.houseCash - accountsPnl;
}
