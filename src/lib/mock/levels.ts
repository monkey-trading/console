/**
 * The mock's take-profit and stop-loss levels, as the engine's V79 checks, attaches and fires them
 * (`levels/request.rs`, `levels/closing.rs`, `levels/trigger.rs`): a level lies at least its market's
 * minimum distance beyond the closing price of the whole position, or a working order's own price, on
 * its own side; it fires when that closing price reaches it, the stop loss first.
 */

import type { EngineEvent, LevelKind, MarketId, OrderRequest, Reject, Side } from "../engine/types";
import { absFixed, fixedToWire, parseFixed, type Fixed } from "../fixed";
import { checkLevels, levelOf, levelsWire, MAX_INPUT, movedLevels, NO_LEVELS, noLevels, type Levels } from "../levels";
import { fillEvents, fillOrder, liveQuote } from "./execute";
import { slotRefusal, writeLevels } from "./level-state";
import type { AccountState, MockState } from "./state";

/** What a request names: no level, the levels, or a level that is not a price the engine takes (`Fixed::is_valid_input`). */
export type Named = { kind: "none" } | { kind: "levels"; levels: Levels } | { kind: "invalid" };

const invalid = (reason: string): Reject => ({ kind: "invalid_order", reason });

/** The levels a request's wire fields name. */
export function namedLevels(wire: { take_profit?: string; stop_loss?: string }): Named {
  if (wire.take_profit === undefined && wire.stop_loss === undefined) return { kind: "none" };
  const read = (text: string | undefined): Fixed | null | false => {
    if (text === undefined) return null;
    const value = parseFixed(text);
    return value !== null && value > 0n && value <= MAX_INPUT ? value : false;
  };
  const [takeProfit, stopLoss] = [read(wire.take_profit), read(wire.stop_loss)];
  return takeProfit === false || stopLoss === false ? { kind: "invalid" } : { kind: "levels", levels: { takeProfit, stopLoss } };
}

/** The price a reduce-only close of a whole position of `held` in `market` fills at now, as the engine's `closing_price_at` prices it; null with no price. */
export function closingPrice(state: MockState, address: string, market: MarketId, held: Fixed): Fixed | null {
  const priced = liveQuote(state, address, market, held > 0n ? "sell" : "buy", absFixed(held), held);
  return priced?.kind === "priced" ? priced.price : null;
}

/** The engine's `check_level_distances`: each level in `levels` at least the market's minimum distance beyond `reference` on its own side. */
export function distanceRefusal(state: MockState, market: MarketId, levels: Levels, long: boolean, reference: Fixed): Reject | null {
  const bps = state.markets.get(market)?.listed.spec.min_level_distance_bps;
  if (bps === undefined) return invalid("the market names no minimum level distance");
  const refused = checkLevels(levels, long, reference, bps);
  return refused === null ? null : { kind: "level_too_close", level: fixedToWire(refused.level), min_distance_bps: bps, reference: fixedToWire(refused.reference) };
}

/**
 * The engine's `check_named_levels` at placement: an order naming levels may not be reduce-only, each
 * level must be a valid price, and a working order's lie beyond its own price. A market order's are
 * checked against its fill (`marketOrderLevels`). `price` is a working order's trigger price.
 */
export function checkNamedLevels(state: MockState, req: OrderRequest, price: Fixed | null): Reject | null {
  const named = namedLevels(req);
  if (named.kind === "none") return null;
  if (req.reduce_only === true) return invalid("a reduce-only order names no levels");
  if (named.kind === "invalid") return invalid("level out of range");
  return price === null ? null : distanceRefusal(state, req.market, named.levels, req.side === "buy", price);
}

/**
 * The engine's `check_order_levels`, run on a market order's priced fill before it is booked: each level
 * set anew or moved lies beyond the closing price of the position the fill leaves on the order's side,
 * and a position holding none has a working order slot free. With no position left on that side there
 * is nothing to check: the levels are dropped after the fill.
 */
export function marketOrderLevels(state: MockState, address: string, account: AccountState, req: { market: MarketId; side: Side; qty: Fixed }, levels: Levels): () => Reject | null {
  return () => {
    const held = account.positions.get(req.market)?.qty ?? 0n;
    const left = held + (req.side === "buy" ? req.qty : -req.qty);
    if (left === 0n || (left > 0n) !== (req.side === "buy")) return null;
    // An add keeps the position's levels; a new position or a reversal takes only the order's.
    const added = held !== 0n && (held > 0n) === (left > 0n);
    const moved = movedLevels(levels, added ? (account.levels.get(req.market) ?? NO_LEVELS) : NO_LEVELS);
    if (!noLevels(moved)) {
      const reference = closingPrice(state, address, req.market, left);
      if (reference === null) return { kind: "no_price" };
      const refused = distanceRefusal(state, req.market, moved, left > 0n, reference);
      if (refused !== null) return refused;
    }
    return account.levels.has(req.market) ? null : slotRefusal(state, account);
  };
}

/** Gives the position a fill on `side` left the levels an order named, each in place of its own, or drops them when the fill left none on that side. */
export function attachLevels(account: AccountState, address: string, market: MarketId, side: Side, levels: Levels): EngineEvent {
  const qty = account.positions.get(market)?.qty ?? 0n;
  if (qty === 0n || (qty > 0n) !== (side === "buy")) return { type: "position_levels_removed", account: address, market, ...levelsWire(levels), reason: "not_opened" };
  const held = account.levels.get(market) ?? NO_LEVELS;
  return writeLevels(account, address, market, { takeProfit: levels.takeProfit ?? held.takeProfit, stopLoss: levels.stopLoss ?? held.stopLoss });
}

/** The level of the account's position in `market` its closing price reaches now, the stop loss first; null while it reaches neither or the market cannot trade. */
function reachedLevel(state: MockState, address: string, account: AccountState, market: MarketId): LevelKind | null {
  const levels = account.levels.get(market);
  const position = account.positions.get(market);
  const runtime = state.markets.get(market);
  if (levels === undefined || position === undefined || runtime === undefined || !runtime.open || runtime.halted) return null;
  const long = position.qty > 0n;
  const price = closingPrice(state, address, market, position.qty);
  if (price === null) return null;
  if (levels.stopLoss !== null && (long ? price <= levels.stopLoss : price >= levels.stopLoss)) return "stop_loss";
  if (levels.takeProfit !== null && (long ? price >= levels.takeProfit : price <= levels.takeProfit)) return "take_profit";
  return null;
}

/** Closes the whole position on its `kind` level at the closing price that reached it, which is the take profit's level or better; a refusal leaves the level for the next price. */
function fireLevel(state: MockState, address: string, account: AccountState, market: MarketId, kind: LevelKind): EngineEvent[] {
  const position = account.positions.get(market);
  const level = levelOf(account.levels.get(market) ?? NO_LEVELS, kind);
  if (position === undefined || level === null) return [];
  const orderId = state.nextOrderId++;
  const outcome = fillOrder(state, { address, market, side: position.qty > 0n ? "sell" : "buy", qty: absFixed(position.qty), reduceOnly: true, orderId, cause: kind });
  if (!outcome.ok) return [];
  return [{ type: "position_level_triggered", account: address, market, level: kind, price: fixedToWire(level), order_id: orderId }, ...fillEvents(outcome)];
}

/** Fires a level of the account's position in `market` its closing price reaches now, after an entry's fill attached it. */
export function checkAttachedLevels(state: MockState, address: string, account: AccountState, market: MarketId): EngineEvent[] {
  const kind = reachedLevel(state, address, account, market);
  return kind === null ? [] : fireLevel(state, address, account, market, kind);
}

/** Fires every level a price reaches, market by market and account by account, as each price's round runs after resting orders and before close-outs. */
export function triggerLevels(state: MockState): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const market of state.markets.keys()) {
    for (const [address, account] of state.accounts) events.push(...checkAttachedLevels(state, address, account, market));
  }
  return events;
}
