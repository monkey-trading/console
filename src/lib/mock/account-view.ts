/** The mock node's `GET /v1/accounts/{address}`: an account's balance, equity, margin, positions, orders, close-outs and close fees. */

import type { AccountView, Address } from "../engine/types";
import { fixedToWire } from "../fixed";
import { feeNow } from "../holding-fee";
import { equityOf, marginOf } from "./accounts";
import { closeoutsOf } from "./closeout-price";
import type { MockState } from "./state";

/** `GET /v1/accounts/{address}` now, without waiting; null for an account the node has never credited. */
export function accountViewOf(state: MockState, address: Address): AccountView | null {
  const account = state.accounts.get(address.toLowerCase());
  // A declared account the node has not credited answers 404 like any other: the engine's `accounts` map holds credits, not references.
  if (!account || !state.credited.has(address.toLowerCase())) return null;
  const positions: AccountView["positions"] = {};
  const closeFees: NonNullable<AccountView["close_fees"]> = {};
  const { profitFeeBps, profitFeeCurve } = state.params;
  for (const [id, held] of account.positions) {
    positions[id] = { qty: fixedToWire(held.qty), entry: fixedToWire(held.entry) };
    // What a close pays at the mock's clock, as the node's `close_fees` gives it.
    const fee = feeNow(held.openedAt, profitFeeBps, profitFeeCurve, state.now);
    closeFees[id] = { opened_at: held.openedAt, fee_bps: fee.feeBps, falls_at: fee.fallsAt };
  }
  const orders: AccountView["orders"] = {};
  for (const [id, order] of account.orders) orders[id] = order;
  const pending = account.pending.reduce((sum, deposit) => sum + deposit.amount, 0n);
  return {
    balance: fixedToWire(account.balance),
    ...(pending > 0n ? { unfinalised_deposits: fixedToWire(pending) } : {}),
    equity: fixedToWire(equityOf(state, account)),
    margin: fixedToWire(marginOf(state, account)),
    positions,
    orders,
    toxicity_bps: 0,
    closeouts: closeoutsOf(state, account),
    close_fees: closeFees,
  };
}
