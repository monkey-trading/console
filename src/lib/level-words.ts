/** Take-profit and stop-loss levels in words: the ticket's and the position editor's help and refusals, and the log's lines. */

import type { LevelEvent, LevelKind, LevelReject, LevelsRemovedReason } from "./engine/level-types";
import type { MarketId } from "./engine/types";
import { spokenRate } from "./fee-words";
import { fixedFromWire, formatFixedPlaces, type Fixed } from "./fixed";
import { roundToPlaces } from "./fixed-rounding";
import { formatLevel, levelAbove, type LevelRefusal } from "./levels";
import { formatMark } from "./price-format";
import type { TicketLimits } from "./tier-view";

/** What the levels are, in the ticket's and the position editor's help. */
export const LEVELS_HELP = [
  "A take profit or stop loss closes your entire position when the price at which it would close reaches the level you set. That closing price is the bid for a long position and the offer for a short position, so a wider spread can trigger a level even when the market price has not moved.",
  "A stop loss is then executed at the next available closing price, which may be worse than your level if the market gaps or reopens after a closure. A take profit is executed at your level or at a better price.",
  "Both differ from a stop order, which opens or adds to a position when the market's reference price reaches its trigger price.",
  "The take profit and stop loss on a position together count as one working order towards your limit.",
] as const;

/** What the ticket's level fields do to a position already held in the market. */
export const TICKET_LEVELS_NOTE = "If you already hold a position in this market, a level entered here replaces the position's current level, and a field left empty keeps it.";

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

/** A wire decimal grouped in thousands, with no trailing zeros: `97500.50` is `97,500.5`. */
function decimal(wire: string): string {
  const text = formatFixedPlaces(fixedFromWire(wire), 9);
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

const REMOVED_BECAUSE: Record<LevelsRemovedReason, string> = {
  closed: "the position was closed",
  close_all: "Close all closed the position",
  take_profit: "the take profit closed the position",
  stop_loss: "the stop loss closed the position",
  close_out: "the position was closed out",
  weekend_close_out: "the position was closed out before the weekend",
  split: "a share split reduced the position to zero",
  reversed: "the position was reversed",
  not_opened: "the order did not leave a position for them to protect",
};

/** The log's line for a level event on `symbol`'s position. */
export function describeLevelEvent(event: LevelEvent, symbolOf: (id: MarketId) => string): string {
  const symbol = symbolOf(event.market);
  switch (event.type) {
    case "position_levels_set": {
      const named = namedLevels(event);
      if (named === null) return `Take profit and stop loss removed from the ${symbol} position`;
      const missing = event.take_profit === undefined ? ", with no take profit" : event.stop_loss === undefined ? ", with no stop loss" : "";
      return `${symbol} position: ${named}${missing}`;
    }
    case "position_level_triggered": return `${TITLES[event.level]} at ${decimal(event.price)} reached on ${symbol}, closing the whole position`;
    case "position_levels_removed": {
      const named = namedLevels(event) ?? "take profit and stop loss";
      return `${named.charAt(0).toUpperCase()}${named.slice(1)} removed from ${symbol} because ${REMOVED_BECAUSE[event.reason]}`;
    }
  }
}

/** The account notice's sentence for a level that closed a position: the market, the level and the price the position closed at. */
export function levelClosedSentence(kind: LevelKind, symbol: string, level: string, filledAt: string | null): string {
  const at = filledAt === null ? "" : ` at ${decimal(filledAt)}`;
  return `Your ${NAMES[kind]} at ${decimal(level)} on ${symbol} was reached, so the entire position was closed${at}.`;
}

/** The level fields' estimate in words: what the level would realise for the order's size before the profit fee, a stop loss's marked as not guaranteed. */
export function describeEstimate(kind: LevelKind, result: Fixed, usd: (value: Fixed) => string): string {
  const what = result >= 0n ? "Estimated profit" : "Estimated loss";
  return `${what} ${usd(result < 0n ? -result : result)} before the profit fee${kind === "stop_loss" ? ", not guaranteed" : ""}`;
}
