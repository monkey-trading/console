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
export const LEVELS_HELP = "A take profit or stop loss closes your entire position when its closing price reaches the level you set. A stop loss may be executed at a worse price than your level if the market gaps.";

/** What the ticket's level fields do to the position an order leaves, by what the order does to the position held: an add keeps a level left empty, a reversal removes the old levels, and a working order's levels apply only once it is executed. */
export const TICKET_LEVELS_NOTES = {
  adds: "This order adds to your position, so each level entered here replaces the current one, and a field left empty keeps it.",
  reverses: "This order reverses your position, so the position's current take profit and stop loss are removed and only the levels entered here apply to the new position.",
  rests: "When this order is executed and adds to your position, each level entered here replaces the current one, and a field left empty keeps it.",
  restsReversing: "When this order is executed and reverses your position, the position's current take profit and stop loss are removed and only the levels entered here apply to the new position.",
  restsReducing: "If this order only reduces your position when it is executed, the levels entered here are discarded.",
} as const;

/** What the position editor's fields do. */
export const EDITOR_LEVELS_NOTE = "Saving replaces the position's levels with the values shown. Leave a field empty to remove that level.";

/** What the Positions panel says once the position whose levels dialog was open has closed. */
export const levelsDialogClosedWords = (symbol: string) => `Your ${symbol} position has been closed, so its take profit and stop loss can no longer be edited. Any changes you had not saved have been discarded.`;

/** Why the take profit and stop loss cannot be checked yet: `why`, or, with none, that they wait for the trading terms. */
export const levelsWait = (why: string | null) => `The take profit and stop loss cannot be checked at the moment. ${why ?? "They will be checked once the trading terms have loaded."}`;

/** An order that only reduces a position has nothing for levels to protect. */
export const REDUCING_ORDER_LEVELS = "A take profit and stop loss cannot be set on this order. It only reduces your position, so there is no new position for the levels to protect. Clear both fields, or set the levels on the position in the Positions list.";

/** What Cancel all's confirmation says while the account holds levels. */
export const CANCEL_ALL_KEEPS_LEVELS = "Cancel all does not remove the take-profit and stop-loss levels on your positions, which stay in place.";

/** What Close all's confirmation says while a position it closes holds levels. */
export const CLOSE_ALL_REMOVES_LEVELS = "Closing these positions also removes their take-profit and stop-loss levels.";

const NAMES: Record<LevelKind, string> = { take_profit: "take profit", stop_loss: "stop loss" };
const TITLES: Record<LevelKind, string> = { take_profit: "Take profit", stop_loss: "Stop loss" };

/** A level's name in a sentence, or at its start. */
export const levelName = (kind: LevelKind, start = false): string => (start ? TITLES[kind] : NAMES[kind]);

/** What a level is measured from: the closing price of the position, a working order's trigger price, or, for a take profit while that closing price is the console's estimate, the market price. */
export type LevelBasis = "closing" | "trigger" | "mark";

const BASES: Record<LevelBasis, { name: string; text: (price: string) => string; rule: string }> = {
  closing: { name: "closing price", text: (price) => `the current closing price of ${price}`, rule: "In this market" },
  trigger: { name: "trigger price", text: (price) => `the order's trigger price of ${price}`, rule: "In this market" },
  mark: { name: "market price", text: (price) => `the current market price of ${price}`, rule: "While the closing price is an estimate" },
};

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
  const basisText = BASES[basis].text(reference);
  const basisName = BASES[basis].name;
  const nearest = formatLevel(roundToPlaces(refusal.bound, places, above ? "up" : "down"), places);
  const direction = above ? "above" : "below";
  const rate = spokenRate(refusal.minDistanceBps);
  const fix = `Set a ${name} of ${nearest} or ${above ? "higher" : "lower"}.`;
  if (refusal.why === "wrong_side") return `${TITLES[refusal.kind]} ${above ? "below" : "above"} the ${basisName}. ${BASES[basis].rule}, a ${name} on ${position} must be ${direction} ${basisText}, by at least ${rate}. ${fix}`;
  return `${TITLES[refusal.kind]} too close to the ${basisName}. ${BASES[basis].rule}, a ${name} on ${position} must be at least ${rate} ${direction} ${basisText}. ${fix}`;
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

/**
 * The engine's refusal of a level, after the request reached it: one closer than the market's minimum distance to the price it
 * is measured from, or on the wrong side of it. That price is a position's closing price or a working order's own price, so it
 * is named as the price the level was measured from, to five places as the other refusals name a price, the level as it was set.
 */
export function describeLevelReject(reject: LevelReject): string {
  if (reject.kind === "levels_unsupported") return "This server does not support take-profit and stop-loss levels yet.";
  return `The level ${decimal(reject.level)} was not accepted. In this market, a take profit or stop loss must be at least ${spokenRate(reject.min_distance_bps)} beyond the price it is measured from, which was ${decimal(reject.reference, 5)} when your request was processed. Set the level further from that price, on the correct side.`;
}

/** A levels request refused for want of a working order slot, in words that say the levels take one. */
export function describeLevelSlotReject(reject: { kind: "tier_order_limit"; tier: number; max: number } | { kind: "too_many_orders"; max: number }): string {
  const who = reject.kind === "tier_order_limit" ? `Volume tier ${reject.tier} allows` : "Your account can have";
  return `Working order limit reached. ${who} up to ${reject.max} working orders at a time, and the take profit and stop loss on a position together count as one. Cancel a working order, or remove the levels from another position, to set levels here.`;
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
  not_opened: "because the order did not open or add to a position for the levels to protect",
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

/** What an estimate covers: on the ticket the size the order opens, at the order's price; in the editor the whole position, from its entry. */
export type EstimateBasis = "order" | "position";

/** The level fields' estimate in words: what the level would realise on `basis` before the profit fee, a stop loss's marked as not guaranteed. */
export function describeEstimate(kind: LevelKind, result: Fixed, usd: (value: Fixed) => string, basis: EstimateBasis): string {
  const what = result >= 0n ? "Estimated profit" : "Estimated loss";
  const on = basis === "order" ? "for the size this order opens" : "for the whole position";
  return `${what} ${usd(result < 0n ? -result : result)} ${on}, before the profit fee${kind === "stop_loss" ? ", not guaranteed" : ""}`;
}
