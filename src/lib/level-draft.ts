/**
 * The Positions tab's levels draft: which position it belongs to, and what a save that lands later does to
 * it. A draft belongs to the account and the market of the position it was opened for, and stays open while
 * that account holds a position there, whatever its size or side. The levels its own saves sent are the
 * position's too until the account shows them, as the account can show them before a save's answer lands,
 * or still show the levels before them after it, when its read failed. Levels changed by anything else, such
 * as an executed order that sets them, replace each field the trader has not edited.
 */

import type { MarketId } from "./engine/types";
import type { LevelFields } from "./level-check";
import { levelsWire, type Levels } from "./levels";

/** The open editor's position, its draft, and the instance it was opened as. */
export interface LevelsDraft {
  market: MarketId;
  owner: string;
  /** The levels the position held when the editor opened, or the newest the account has shown since. */
  base: Levels;
  /** The levels each save from this editor sent that the account has yet to show, oldest first. */
  sent: readonly Levels[];
  fields: LevelFields;
  instance: number;
}

/** A position the account holds now. */
export interface HeldPosition {
  market: MarketId;
  levels: Levels;
}

const sameLevels = (a: Levels, b: Levels) => a.takeProfit === b.takeProfit && a.stopLoss === b.stopLoss;

/** The fields a position's levels prefill: each as the plain digits it was set with, or empty. */
export function fieldsOf(levels: Levels): LevelFields {
  const wire = levelsWire(levels);
  return { takeProfit: wire.take_profit ?? "", stopLoss: wire.stop_loss ?? "" };
}

/**
 * `draft` while the account `owner` still holds a position in its market, null once it does not. Once the account shows one of its saves'
 * levels, they are its base, and the saves before it are behind it; levels it did not send become its base, and each field that still shows
 * the old base's level shows the new one.
 */
export function openDraft(draft: LevelsDraft | null, owner: string | null, held: readonly HeldPosition[]): LevelsDraft | null {
  if (draft === null || draft.owner !== owner) return null;
  const position = held.find((p) => p.market === draft.market);
  if (position === undefined) return null;
  if (sameLevels(position.levels, draft.base)) return draft;
  const shown = draft.sent.findIndex((levels) => sameLevels(position.levels, levels));
  if (shown !== -1) return { ...draft, base: position.levels, sent: draft.sent.slice(shown + 1) };
  const was = fieldsOf(draft.base);
  const now = fieldsOf(position.levels);
  const fields = {
    takeProfit: draft.fields.takeProfit === was.takeProfit ? now.takeProfit : draft.fields.takeProfit,
    stopLoss: draft.fields.stopLoss === was.stopLoss ? now.stopLoss : draft.fields.stopLoss,
  };
  return { ...draft, base: position.levels, fields };
}

/** Whether `draft` goes because its position closed, which the panel then says: its account is still connected and holds no position in its market. */
export function positionClosed(draft: LevelsDraft, owner: string | null, held: readonly HeldPosition[]): boolean {
  return draft.owner === owner && !held.some((p) => p.market === draft.market);
}

/** A save's words and the dialog instance it was sent from. */
export interface SaveWords {
  text: string;
  instance: number;
}

/** What the open dialog `draft` reads out: the words of its own save that landed while it stayed open, or nothing. */
export const dialogAnnouncement = (draft: LevelsDraft | null, said: SaveWords | null): string => (draft !== null && said?.instance === draft.instance ? said.text : "");

/** `draft` once a save from it sends `levels`, which the position may show as its own from then on. */
export function sentFrom(draft: LevelsDraft, levels: Levels): LevelsDraft {
  return { ...draft, sent: [...draft.sent, levels] };
}

/**
 * What a save of `sent` from editor `instance` does once it lands, given the draft open now: for an editor closed or
 * reopened since, report what was saved above the positions, or in the dialog open now; say what was saved while it is
 * open, leaving the draft as it is, since its levels count as the position's until the account shows them; and close it
 * too while it still holds the fields sent.
 */
export function landedSave(latest: LevelsDraft | null, instance: number, sent: LevelFields): "report" | "announce" | "close" {
  if (latest === null || latest.instance !== instance) return "report";
  return latest.fields === sent ? "close" : "announce";
}

/**
 * Whether a save of `market`'s levels is on its way, from the open dialog or from one closed before it, so that Save is held and a
 * second request for the same levels is never sent while the first waits on the wallet.
 */
export const savePending = (saving: { market: MarketId } | null, open: { market: MarketId } | null, market: MarketId): boolean => open?.market === market && saving?.market === market;

/** Whether focus is still where a closed dialog left it, on the page or the Positions panel, rather than moved by the trader to a control of their own. */
export const focusUnmoved = (active: unknown, page: unknown, panel: unknown): boolean => active === null || active === page || active === panel;
