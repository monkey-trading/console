/** An account's equity and margin at the current marks, and the house's exposure. */

import { mulFixed, type Fixed } from "../fixed";
import { tieredMargin } from "../pricing";
import { decodeTiers, flooredMargin, type TierTerms } from "../volume-tier";
import type { AccountState, MockState } from "./state";
import { tierNow } from "./volume";

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

/** The volume tier table in the mock's parameters; empty when they name none. */
export function tierTable(state: MockState): TierTerms[] {
  return decodeTiers(state.params.volumeTiers ?? []) ?? [];
}

/** The account's volume tier now and its terms; tier 0 with no terms when the parameters name no table. */
export function tierOfAccount(state: MockState, account: AccountState): { tier: number; terms: TierTerms | null } {
  const table = tierTable(state);
  const tier = tierNow(account.volume, table, state.now);
  return { tier, terms: table[tier] ?? null };
}

/** The margin floor of the account's tier, in bps: each margin band charges at least this in the initial requirement. */
export function marginFloorOf(state: MockState, account: AccountState): number {
  return tierOfAccount(state, account).terms?.marginFloorBps ?? 0;
}

/** The account's initial requirement: its margin with each band charged at least its tier's floor, which fills that add risk and withdrawals must leave equity above. */
export function initialMarginOf(state: MockState, account: AccountState): Fixed {
  const floor = marginFloorOf(state, account);
  let total = 0n;
  for (const [id, held] of account.positions) {
    const market = state.markets.get(id);
    if (market) total += flooredMargin(market.listed.spec.margin_tiers, mulFixed(held.qty, market.mid), floor);
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

/** The house's net asset value: its cash less what accounts hold unrealised. */
export function houseNav(state: MockState): Fixed {
  let accountsPnl = 0n;
  for (const account of state.accounts.values()) accountsPnl += unrealised(state, account);
  return state.houseCash - accountsPnl;
}
