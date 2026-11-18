/** Take-profit and stop-loss levels in words: the ticket's and the position editor's help and refusals, and the log's lines. */

import type { LevelEvent, LevelKind, LevelReject, LevelsRemovedReason } from "./engine/level-types";
import type { MarketId } from "./engine/types";
import { spokenRate } from "./fee-words";
import { fixedFromWire, formatFixedPlaces, type Fixed } from "./fixed";
import { roundToPlaces } from "./fixed-rounding";
import { formatLevel, levelAbove, type LevelRefusal, type Levels } from "./levels";
import { formatMark } from "./price-format";
import type { TicketLimits } from "./tier-view";

/** A problem's first sentence, which says what is wrong without the prices that move with the market: what a live region reads out. */
export function headline(problem: string): string {
  const end = problem.indexOf(". ");
  return end === -1 ? problem : problem.slice(0, end + 1);
}

/** What the levels are, in the ticket's and the position editor's help. */
export const LEVELS_HELP = [
  "A take profit or stop loss closes your entire position when the price at which it would close reaches the level you set. That closing price is the bid for a long position and the offer for a short position, so a wider spread can trigger a level even when the market price has not moved.",
  "A stop loss is then executed at the next available closing price, which may be worse than your level if the market gaps or reopens after a closure. A take profit is executed at your level or at a better price.",
  "Both differ from a stop order, which opens or adds to a position when the market's reference price reaches its trigger price.",
  "The take profit and stop loss on a position together count as one working order towards your limit.",
] as const;

/** What the ticket's level fields do to the position an order leaves, by what the order does to the position held: an add keeps a level left empty, a reversal removes the old levels, and a working order's levels apply only once it is executed. */
export const TICKET_LEVELS_NOTES = {
  adds: "This order adds to your position. Each level entered here replaces the position's current level, and a field left empty keeps the current level.",
  reverses: "This order reverses your position, so the position's current take profit and stop loss are removed, and only the levels entered here apply to the new position.",
  rests: "The levels entered here apply only once the order is executed. If the order then adds to your position, each level replaces the position's current level, and a field left empty keeps the current level.",
  restsReducing: "If this order is executed while your current position is still open, it reduces that position instead of opening one on its own side, and the levels entered here are then discarded.",
} as const;

/** What the position editor's fields do. */
export const EDITOR_LEVELS_NOTE = "Saving replaces the position's levels with the values shown. Leave a field empty to remove that level.";

/** An order that only reduces a position has nothing for levels to protect. */
export const REDUCING_ORDER_LEVELS = "A take profit and stop loss cannot be set on this order. It only reduces your position, so there is no new position for the levels to protect. Clear both fields, or set the levels on the position in the Positions list.";

/** What Cancel all's confirmation says while the account holds levels. */
export const CANCEL_ALL_KEEPS_LEVELS = "The take-profit and stop-loss levels on your positions are not working orders, so Cancel all leaves them in place.";

/** What Close all's confirmation says while a position it closes holds levels. */
export const CLOSE_ALL_REMOVES_LEVELS = "Closing these positions also removes their take-profit and stop-loss levels.";

const NAMES: Record<LevelKind, string> = { take_profit: "take profit", stop_loss: "stop loss" };
const TITLES: Record<LevelKind, string> = { take_profit: "Take profit", stop_loss: "Stop loss" };

/** A level's name in a sentence, or at its start. */
export const levelName = (kind: LevelKind, start = false): string => (start ? TITLES[kind] : NAMES[kind]);

/** What a level is measured from: the closing price of the position, or a working order's trigger price. */
export type LevelBasis = "closing" | "trigger";

/**
 * Why a level is refused before anything is signed, and the nearest level accepted at the market's
 * places: what is wrong, the rule, then the level to set.
 */
export function describeLevelRefusal(refusal: LevelRefusal, long: boolean, places: number, basis: LevelBasis): string {
  const above = levelAbove(refusal.kind, long);
  const name = NAMES[refusal.kind];
  const position = long ? "a long position" : "a short position";
  // The reference is a price like any other on screen; the level to set is exact, rounded away from it.
  const reference = formatMark(refusal.reference, places);
  const basisText = basis === "closing" ? `the price at which the position would close, which is currently ${reference}` : `the order's trigger price of ${reference}`;
  const basisName = basis === "closing" ? "closing price" : "trigger price";
  const nearest = formatLevel(roundToPlaces(refusal.bound, places, above ? "up" : "down"), places);
  const direction = above ? "above" : "below";
  const rate = spokenRate(refusal.minDistanceBps);
  const fix = `Set a ${name} of ${nearest} or ${above ? "higher" : "lower"}.`;
  if (refusal.why === "wrong_side") return `${TITLES[refusal.kind]} ${above ? "below" : "above"} the ${basisName}. A ${name} on ${position} must be ${direction} ${basisText}, by at least ${rate} in this market. ${fix}`;
  return `${TITLES[refusal.kind]} too close to the ${basisName}. In this market, a ${name} on ${position} must be at least ${rate} ${direction} ${basisText}. ${fix}`;
}

/** The ticket's and the editor's stop for a first pair of levels past the account's working order limit; null while there is room or the tier names no limit. */
export function levelSlotProblem(limits: TicketLimits | null, needsSlot: boolean): string | null {
  if (!needsSlot || limits === null || limits.orderLimit === null || limits.resting < limits.orderLimit) return null;
  return `Working order limit reached. Volume tier ${limits.tier} allows up to ${limits.orderLimit} working orders at a time, and the take profit and stop loss on a position together count as one. Cancel a working order, or remove the levels from another position, to set levels here.`;
}

/** A wire decimal grouped in thousands, with at most `places` places and no trailing zeros: `97500.50` is `97,500.5`. */
function decimal(wire: string, places = 9): string {
  const text = formatFixedPlaces(fixedFromWire(wire), places);
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

/** The engine's refusal of a level closer than the market's minimum distance, after the request reached it. */
export function describeLevelReject(reject: LevelReject): string {
  if (reject.kind === "levels_unsupported") return "This server does not support take-profit and stop-loss levels yet.";
  return `The level ${decimal(reject.level)} is too close to the current price. In this market, a take profit or stop loss must be at least ${spokenRate(reject.min_distance_bps)} beyond the price at which the position would close, which was ${decimal(reject.reference)} when your request was processed. Choose a level further from the current price.`;
}

/** The levels an event names, as a phrase: `take profit at 105,000 and stop loss at 95,000`. */
function namedLevels(event: { take_profit?: string; stop_loss?: string }): string | null {
  const parts = [event.take_profit === undefined ? null : `take profit at ${decimal(event.take_profit)}`, event.stop_loss === undefined ? null : `stop loss at ${decimal(event.stop_loss)}`].filter((p) => p !== null);
  return parts.length === 0 ? null : parts.join(" and ");
}

/** Why levels were removed, as the end of a sentence. A split's reason also covers a level it scaled out of range, so it names only the split. */
const REMOVED_BECAUSE: Record<LevelsRemovedReason, string> = {
  closed: "because the position was closed",
  close_all: "because Close all closed the position",
  take_profit: "because the take profit closed the position",
  stop_loss: "because the stop loss closed the position",
  close_out: "because the position was closed out",
  weekend_close_out: "because the position was closed out before the weekend",
  split: "because of a share split",
  reversed: "because the position was reversed",
  not_opened: "because the order did not leave a position on its side for the levels to protect",
};

/** The log's line for a level event on `symbol`'s position, as a whole sentence without its full stop, as the log's other lines are. */
export function describeLevelEvent(event: LevelEvent, symbolOf: (id: MarketId) => string): string {
  const symbol = symbolOf(event.market);
  switch (event.type) {
    case "position_levels_set": {
      const { take_profit: take, stop_loss: stop } = event;
      if (take === undefined && stop === undefined) return `The take profit and stop loss were removed from the ${symbol} position`;
      if (stop === undefined) return `The take profit on the ${symbol} position was set at ${decimal(take ?? "0")}, with no stop loss`;
      if (take === undefined) return `The stop loss on the ${symbol} position was set at ${decimal(stop)}, with no take profit`;
      return `The take profit on the ${symbol} position was set at ${decimal(take)} and the stop loss at ${decimal(stop)}`;
    }
    case "position_level_triggered": return `The ${NAMES[event.level]} at ${decimal(event.price)} on ${symbol} was reached, and the whole position was closed`;
    case "position_levels_removed": {
      const named = namedLevels(event) ?? "take profit and stop loss";
      const both = event.take_profit !== undefined && event.stop_loss !== undefined;
      const where = event.reason === "not_opened" ? `named on the ${symbol} order` : `on ${symbol}`;
      return `The ${named} ${where} ${both || namedLevels(event) === null ? "were" : "was"} removed ${REMOVED_BECAUSE[event.reason]}`;
    }
  }
}

/** The levels `levels` names, as the wallet's prompt states them at the market's places: `a take profit at 105,000.00 and a stop loss at 95,000.00`; null for none. */
export function describeNamedLevels(levels: Levels, places: number): string | null {
  const parts = [levels.takeProfit === null ? null : `a take profit at ${formatLevel(levels.takeProfit, places)}`, levels.stopLoss === null ? null : `a stop loss at ${formatLevel(levels.stopLoss, places)}`].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" and ");
}

/** What a screen reader hears once a position's levels are saved: what the position now holds. */
export function levelsSavedWords(symbol: string, levels: Levels, places: number): string {
  const take = levels.takeProfit === null ? null : formatLevel(levels.takeProfit, places);
  const stop = levels.stopLoss === null ? null : formatLevel(levels.stopLoss, places);
  if (take === null && stop === null) return `The take profit and stop loss on your ${symbol} position have been removed.`;
  if (stop === null) return `The take profit on your ${symbol} position is now ${take}, and it has no stop loss.`;
  if (take === null) return `The stop loss on your ${symbol} position is now ${stop}, and it has no take profit.`;
  return `The take profit on your ${symbol} position is now ${take}, and the stop loss is ${stop}.`;
}

/** The account notice's sentence for a level that closed a position: the market, the level as set and the price the position closed at, to five places as History shows a fill's. */
export function levelClosedSentence(kind: LevelKind, symbol: string, level: string, filledAt: string | null): string {
  const at = filledAt === null ? "" : ` at ${decimal(filledAt, 5)}`;
  return `Your ${NAMES[kind]} at ${decimal(level)} on ${symbol} was reached, so the entire position was closed${at}.`;
}

/** The level fields' estimate in words: what the level would realise for the order's size before the profit fee, a stop loss's marked as not guaranteed. */
export function describeEstimate(kind: LevelKind, result: Fixed, usd: (value: Fixed) => string): string {
  const what = result >= 0n ? "Estimated profit" : "Estimated loss";
  return `${what} ${usd(result < 0n ? -result : result)} before the profit fee${kind === "stop_loss" ? ", not guaranteed" : ""}`;
}
