/**
 * Take-profit and stop-loss levels on a position, as the engine's V79 holds them (`engine_core::levels`):
 * which side of its reference price a level must lie on and how far (`Engine::check_level_distances`),
 * the levels a change sets anew or moves (`PositionLevels::moved_from`), which a request checks alone,
 * and what a level would realise.
 */

import type { LevelKind, PositionLevelsWire } from "./engine/level-types";
import type { MarketView } from "./engine/types";
import { absFixed, fixedFromInt, fixedToWire, formatFixedPlaces, parseFixed, type Fixed } from "./fixed";
import { mulBpsRounded, mulRounded } from "./fixed-rounding";

/** A position's take profit and stop loss, either absent. */
export interface Levels {
  takeProfit: Fixed | null;
  stopLoss: Fixed | null;
}

export const NO_LEVELS: Levels = { takeProfit: null, stopLoss: null };

/** The largest price the engine accepts as input (`Fixed::MAX_INPUT`). */
const MAX_INPUT = fixedFromInt(1_000_000_000);

/** Why a level is refused against its reference: on the other side of it, or on its side but closer than the market's minimum distance. `bound` is the nearest level the engine accepts. */
export interface LevelRefusal {
  kind: LevelKind;
  why: "wrong_side" | "too_close";
  level: Fixed;
  bound: Fixed;
  reference: Fixed;
  minDistanceBps: number;
}

/** The market's minimum level distance in bps, or null for a market that takes no levels: one listed before V79, or by a node that predates it. */
export function minLevelDistance(view: MarketView): number | null {
  const bps = view.min_level_distance_bps;
  return bps !== undefined && Number.isSafeInteger(bps) && bps > 0 ? bps : null;
}

/** The levels the account read gives a position, a malformed one read as absent. */
export function decodeLevels(wire: PositionLevelsWire | undefined): Levels {
  const read = (text: string | undefined) => (text === undefined ? null : parseFixed(text));
  return { takeProfit: read(wire?.take_profit), stopLoss: read(wire?.stop_loss) };
}

/** Levels in their wire form, each left out while unset, as a request names them and the account read lists them. */
export function levelsWire(levels: Levels): PositionLevelsWire {
  return {
    ...(levels.takeProfit === null ? {} : { take_profit: fixedToWire(levels.takeProfit) }),
    ...(levels.stopLoss === null ? {} : { stop_loss: fixedToWire(levels.stopLoss) }),
  };
}

/** The level of `kind`. */
export function levelOf(levels: Levels, kind: LevelKind): Fixed | null {
  return kind === "take_profit" ? levels.takeProfit : levels.stopLoss;
}

/** Whether neither level is set. */
export function noLevels(levels: Levels): boolean {
  return levels.takeProfit === null && levels.stopLoss === null;
}

/** Whether a level of `kind` lies above its reference: a long position's take profit and a short position's stop loss. */
export function levelAbove(kind: LevelKind, long: boolean): boolean {
  return (kind === "take_profit") === long;
}

/** The levels in `next` that `held` does not already hold, which are the only ones a change checks, as the engine's `moved_from` reads them. */
export function movedLevels(next: Levels, held: Levels): Levels {
  return {
    takeProfit: next.takeProfit !== held.takeProfit ? next.takeProfit : null,
    stopLoss: next.stopLoss !== held.stopLoss ? next.stopLoss : null,
  };
}

/**
 * Checks a level of `kind` on a long position (`long`) or a short one against `reference`, as the engine
 * does: at least `minDistanceBps` of the reference, rounded up, beyond it on its own side. Null when it lies there.
 */
export function checkLevel(kind: LevelKind, level: Fixed, long: boolean, reference: Fixed, minDistanceBps: number): LevelRefusal | null {
  const distance = mulBpsRounded(reference, minDistanceBps, "up");
  const above = levelAbove(kind, long);
  const bound = above ? reference + distance : reference - distance;
  if (above ? level >= bound : level <= bound) return null;
  const wrongSide = above ? level < reference : level > reference;
  return { kind, why: wrongSide ? "wrong_side" : "too_close", level, bound, reference, minDistanceBps };
}

/** Checks each level `levels` names, the take profit first, returning the first refusal or null. */
export function checkLevels(levels: Levels, long: boolean, reference: Fixed, minDistanceBps: number): LevelRefusal | null {
  const pairs: [LevelKind, Fixed | null][] = [["take_profit", levels.takeProfit], ["stop_loss", levels.stopLoss]];
  for (const [kind, level] of pairs) {
    const refused = level === null ? null : checkLevel(kind, level, long, reference, minDistanceBps);
    if (refused !== null) return refused;
  }
  return null;
}

/** What a level's field holds: nothing, a level, or text it refuses with the reason. */
export type LevelInput = { kind: "empty" } | { kind: "level"; level: Fixed } | { kind: "refused"; message: string };

/** Reads a level's field as the price typed, exactly: digits and one decimal point, above zero and within the engine's input range. */
export function parseLevel(text: string, name: string): LevelInput {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  const level = parseFixed(trimmed);
  if (level === null) return { kind: "refused", message: `Enter the ${name} in digits, such as 61250.50.` };
  if (level <= 0n) return { kind: "refused", message: `Enter a ${name} above zero.` };
  if (level > MAX_INPUT) return { kind: "refused", message: `The ${name} is above the highest price the server accepts.` };
  return { kind: "level", level };
}

/** A level at the market's places, with any finer digits it was set with kept, so it is never shown as another price. */
export function formatLevel(level: Fixed, places: number): string {
  const full = formatFixedPlaces(level, 9).replace(/0+$/, "");
  const decimals = full.length - full.indexOf(".") - 1;
  return formatFixedPlaces(level, Math.max(places, decimals));
}

/**
 * What closing `qty` units of a long (`long`) or short position opened at `entry` would realise at
 * `level`, before the profit fee, in USD: rounded down as the engine books a close.
 */
export function resultAtLevel(long: boolean, entry: Fixed, qty: Fixed, level: Fixed, toUsdDown: (amount: Fixed) => Fixed): Fixed {
  const move = long ? level - entry : entry - level;
  return toUsdDown(mulRounded(move, absFixed(qty), "down"));
}
