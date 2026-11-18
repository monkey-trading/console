/**
 * The Positions tab's levels draft: which position it belongs to, and what a save that lands later does to
 * it. A draft belongs to the account, the market and side, the entry, the open time and the levels of the
 * position it was opened for, so a position that closed and reopened, had a fill change it, or had its levels
 * changed elsewhere never inherits a draft typed for what it was before. The levels its own save sent are
 * the position's too, as the account can show them before the save's answer lands.
 */

import type { MarketId } from "./engine/types";
import type { Fixed } from "./fixed";
import type { LevelFields } from "./level-check";
import type { Levels } from "./levels";

/** The open editor's position as it was opened, its draft, and the instance it was opened as. */
export interface LevelsDraft {
  market: MarketId;
  owner: string;
  long: boolean;
  entry: Fixed;
  opened: number | null;
  /** The levels the position held when the editor opened, or when its last save landed. */
  base: Levels;
  /** The levels a save from this editor sent and has yet to land; null with none on its way. */
  sent: Levels | null;
  fields: LevelFields;
  instance: number;
}

/** A position the account holds now. */
export interface HeldPosition {
  market: MarketId;
  long: boolean;
  entry: Fixed;
  /** When the position opened, as the account read gives it (`closeFee.openedAt`); null where it gives none. */
  opened: number | null;
  levels: Levels;
}

const sameLevels = (a: Levels, b: Levels) => a.takeProfit === b.takeProfit && a.stopLoss === b.stopLoss;

/** `draft` while the account `owner` still holds the position it was opened for, unchanged; null once it does not. */
export function openDraft(draft: LevelsDraft | null, owner: string | null, held: readonly HeldPosition[]): LevelsDraft | null {
  if (draft === null || draft.owner !== owner) return null;
  const position = held.find((p) => p.market === draft.market);
  if (position === undefined || position.long !== draft.long || position.entry !== draft.entry || position.opened !== draft.opened) return null;
  return sameLevels(position.levels, draft.base) || (draft.sent !== null && sameLevels(position.levels, draft.sent)) ? draft : null;
}

/**
 * What a save of `sent` from editor `instance` does once it lands, given the draft open now: nothing for an
 * editor closed, reopened or dropped since; say what was saved while it is open, its levels now the base;
 * and close it too while it still holds the fields sent.
 */
export function landedSave(latest: LevelsDraft | null, instance: number, sent: LevelFields): "ignore" | "announce" | "close" {
  if (latest === null || latest.instance !== instance) return "ignore";
  return latest.fields === sent ? "close" : "announce";
}
