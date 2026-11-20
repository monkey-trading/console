/** The mock node's `GET /v1/accounts/{address}`: an account's balance, equity, margin, positions, orders, close-outs, close fees, levels and, under its grid, its portfolio requirement. */

import type { AccountView, Address } from "../engine/types";
import { fixedToWire } from "../fixed";
import { feeNow } from "../holding-fee";
import { maxLeverage } from "../volume-tier";
import { standingOf } from "./volume";
import { withdrawable } from "./funds";
import { closeoutRequirementOf, equityOf, feeBaseOf, initialMarginOf, marginFloorOf, marginOf, tierTable } from "./accounts";
import { closeoutsOf } from "./closeout-price";
import { closeoutShare, portfolioStanding } from "./portfolio";
import { levelsWire } from "../levels";
import type { MockState } from "./state";

/** `GET /v1/accounts/{address}` now, without waiting; null for an account the node has never credited. */
export function accountViewOf(state: MockState, address: Address): AccountView | null {
  const account = state.accounts.get(address.toLowerCase());
  // A declared account the node has not credited answers 404 like any other: the engine's `accounts` map holds credits, not references.
  if (!account || !state.credited.has(address.toLowerCase())) return null;
  const positions: AccountView["positions"] = {};
  const closeFees: NonNullable<AccountView["close_fees"]> = {};
  const { profitFeeCurve } = state.params;
  const profitFeeBps = feeBaseOf(state, account);
  for (const [id, held] of account.positions) {
    positions[id] = { qty: fixedToWire(held.qty), entry: fixedToWire(held.entry) };
    // What a close pays at the mock's clock, as the node's `close_fees` gives it.
    const fee = feeNow(held.openedAt, profitFeeBps, profitFeeCurve, state.now);
    closeFees[id] = { opened_at: held.openedAt, fee_bps: fee.feeBps, falls_at: fee.fallsAt };
  }
  // From V79 each position's levels, by market, and the field absent while none holds any, as the node serves them.
  const levels: NonNullable<AccountView["levels"]> = {};
  for (const [id, held] of account.levels) levels[id] = levelsWire(held);
  const orders: AccountView["orders"] = {};
  for (const [id, order] of account.orders) orders[id] = order;
  const pending = account.pending.reduce((sum, deposit) => sum + deposit.amount, 0n);
  const margin = marginOf(state, account);
  // From V64 the requirement a fill and a withdrawal meet charges each band at least the tier's floor; a close-out reads the market's own bands.
  // From V81 and V84, under the grid, both are the portfolio requirement: each offset group's credit off the bands.
  const floor = marginFloorOf(state, account);
  const portfolio = portfolioStanding(state, account, floor);
  const maxLeverages: Record<string, string> = {};
  for (const [id, runtime] of state.markets) maxLeverages[String(id)] = fixedToWire(maxLeverage(runtime.listed.spec.margin_tiers, floor));
  return {
    balance: fixedToWire(account.balance),
    ...(pending > 0n ? { unfinalised_deposits: fixedToWire(pending) } : {}),
    equity: fixedToWire(equityOf(state, account)),
    margin: fixedToWire(margin),
    initial_margin: fixedToWire(initialMarginOf(state, account)),
    maintenance_margin: fixedToWire(closeoutShare(state, closeoutRequirementOf(state, account))),
    withdrawable: fixedToWire(withdrawable(state, address)),
    max_leverage: maxLeverages,
    positions,
    orders,
    toxicity_bps: 0,
    // The mock scores no toxicity: every account is untiered and adds nothing.
    toxicity: { score: "0", fills: "0", tier: 0, add_on_bps: 0 },
    volume: standingOf(account.volume, tierTable(state), state.now, new Map([...state.markets].map(([id, runtime]) => [id, runtime.listed.spec]))),
    closeouts: closeoutsOf(state, account),
    close_fees: closeFees,
    ...(account.levels.size > 0 ? { levels } : {}),
    ...(portfolio === undefined ? {} : { portfolio_margin: portfolio }),
  };
}
