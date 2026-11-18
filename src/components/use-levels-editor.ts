"use client";

/**
 * The Positions tab's one levels editor: which position it is open under, the fields typed in it, held
 * here so the table's and the cards' editors show the same draft across a change of layout, and what a
 * save says to a screen reader. Each opening is a new instance, and a save that lands later closes only
 * the instance and draft it was sent from, returning focus to the row's Edit button when it held focus.
 */

import { useRef, useState } from "react";

import type { MarketId } from "@/lib/engine/types";
import type { LevelFields } from "@/lib/level-check";
import { levelsWire, type Levels } from "@/lib/levels";
import type { ConsoleStore } from "@/lib/store/store";

/** The open editor's position, its draft, and the instance it was opened as. */
export interface LevelsDraft {
  market: MarketId;
  fields: LevelFields;
  instance: number;
}

/** The fields a position's levels prefill: each as the plain digits it was set with, or empty. */
function fieldsOf(levels: Levels): LevelFields {
  const wire = levelsWire(levels);
  return { takeProfit: wire.take_profit ?? "", stopLoss: wire.stop_loss ?? "" };
}

/** The ids of a row's Edit buttons, in the table and on the card: a closing editor gives focus back to the one on screen. */
export const editButtonIds = (id: string, market: MarketId) => [`${id}-edit-${market}`, `${id}-edit-card-${market}`];

export function useLevelsEditor(store: ConsoleStore, id: string) {
  const [draft, setDraft] = useState<LevelsDraft | null>(null);
  const [announced, setAnnounced] = useState("");
  // The draft as the handlers last set it, which a save that lands later compares with; written only in handlers.
  const latest = useRef<LevelsDraft | null>(null);
  const opened = useRef(0);
  const set = (next: LevelsDraft | null) => {
    latest.current = next;
    setDraft(next);
  };
  /** Whether focus is in the open editor, or was dropped from it: only then does closing move it. */
  const focusInEditor = () => {
    const active = document.activeElement;
    return active === null || active === document.body || active.closest("[data-levels-editor]") !== null;
  };
  const refocus = (market: MarketId) => {
    const shown = editButtonIds(id, market).map((key) => document.getElementById(key)).find((el) => el !== null && el.offsetParent !== null);
    shown?.focus();
  };
  return {
    draft,
    announced,
    /** Opens the editor under `market`'s row with its levels, or closes it there. */
    toggle: (market: MarketId, held: Levels) => {
      store.clearNotice("levels");
      opened.current += 1;
      set(latest.current?.market === market ? null : { market, fields: fieldsOf(held), instance: opened.current });
    },
    edit: (fields: LevelFields) => {
      if (latest.current !== null) set({ ...latest.current, fields });
    },
    cancel: (market: MarketId) => {
      const refocusing = focusInEditor();
      set(null);
      if (refocusing) refocus(market);
    },
    /** A save of `sent` from `instance` landed: says what was saved, and closes that editor if it still holds that draft. */
    saved: (instance: number, sent: LevelFields, market: MarketId, words: string) => {
      setAnnounced(words);
      const now = latest.current;
      if (now === null || now.instance !== instance || now.fields !== sent) return;
      const refocusing = focusInEditor();
      set(null);
      if (refocusing) refocus(market);
    },
  };
}
