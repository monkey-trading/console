/**
 * The mock's bookkeeping of take-profit and stop-loss levels, as the engine's V79 keeps them on each
 * position (`engine_core::levels`): their setting and removal with its reason, and the working order
 * slots they take.
 */

import type { EngineEvent, LevelsRemovedReason, MarketId, Reject } from "../engine/types";
import type { Fixed } from "../fixed";
import { levelsWire, noLevels, type Levels } from "../levels";
import { tierOfAccount } from "./accounts";
import type { AccountState, MockState } from "./state";

/** Most limit and stop orders an account may rest, where its tier names no limit. */
export const MAX_RESTING = 10;

/** What a fill is booked as, which names why a full close removes the position's levels (`FillCause`). */
export type FillCause = "order" | "close_all" | "take_profit" | "stop_loss" | "close_out";

const REMOVAL: Record<FillCause, LevelsRemovedReason> = { order: "closed", close_all: "close_all", take_profit: "take_profit", stop_loss: "stop_loss", close_out: "close_out" };

/** Sets the levels of the account's position in `market`, dropping the entry when neither is set, and the event that says so. */
export function writeLevels(account: AccountState, address: string, market: MarketId, levels: Levels): EngineEvent {
  if (noLevels(levels)) account.levels.delete(market);
  else account.levels.set(market, levels);
  return { type: "position_levels_set", account: address, market, ...levelsWire(levels) };
}

/** Removes the levels of the account's position in `market`, if it holds any, with the event naming them and why. */
export function removeLevels(account: AccountState, address: string, market: MarketId, reason: LevelsRemovedReason): EngineEvent | null {
  const held = account.levels.get(market);
  if (held === undefined) return null;
  account.levels.delete(market);
  return { type: "position_levels_removed", account: address, market, ...levelsWire(held), reason };
}

/** After a fill took the position from `held` to `left`: removes its levels when the fill closed it or turned it, as the engine's `settle_levels` does. */
export function settleLevels(account: AccountState, address: string, market: MarketId, held: Fixed, left: Fixed, cause: FillCause): EngineEvent | null {
  if (left === 0n) return removeLevels(account, address, market, REMOVAL[cause]);
  if (held !== 0n && (left > 0n) !== (held > 0n)) return removeLevels(account, address, market, "reversed");
  return null;
}

/**
 * The refusal for a new working order slot, or null while one is free: the tier's limit where its table
 * names one (from V66), else the mock's cap; each market holding levels takes one slot (from V79).
 */
export function slotRefusal(state: MockState, account: AccountState): Reject | null {
  const used = account.orders.size + account.levels.size;
  const { tier, terms } = tierOfAccount(state, account);
  if (terms?.maxRestingOrders != null) return used >= terms.maxRestingOrders ? { kind: "tier_order_limit", tier, max: terms.maxRestingOrders } : null;
  return used >= MAX_RESTING ? { kind: "invalid_order", reason: `your account already has the maximum of ${MAX_RESTING} working orders` } : null;
}
