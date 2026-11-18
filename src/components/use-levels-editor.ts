"use client";

/**
 * The Positions tab's one levels editor: which position it is open under, the fields typed in it, held
 * here so the table's and the cards' editors show the same draft across a change of layout, and what a
 * save says to a screen reader. A draft belongs to the account and the side of the position it was
 * opened for, and is dropped once that position is no longer held, so a later position in the market or
 * another account never inherits it. Each opening is a new instance, and a save that lands later closes
 * only the instance and draft it was sent from, returning focus to the row's Edit button when it held focus.
 */

import { useEffect, useRef, useState } from "react";

import type { MarketId } from "@/lib/engine/types";
import type { LevelFields } from "@/lib/level-check";
import { levelsWire, type Levels } from "@/lib/levels";
import type { ConsoleStore } from "@/lib/store/store";

/** The open editor's position, the account and side it was opened for, its draft, and the instance it was opened as. */
export interface LevelsDraft {
  market: MarketId;
  owner: string;
  long: boolean;
  fields: LevelFields;
  instance: number;
}

/** A position the account holds now: its market and side. */
export interface HeldPosition {
  market: MarketId;
  long: boolean;
}

/** The fields a position's levels prefill: each as the plain digits it was set with, or empty. */
function fieldsOf(levels: Levels): LevelFields {
  const wire = levelsWire(levels);
  return { takeProfit: wire.take_profit ?? "", stopLoss: wire.stop_loss ?? "" };
}

/** The ids of a row's Edit buttons, in the table and on the card: a closing editor gives focus back to the one on screen. */
export const editButtonIds = (id: string, market: MarketId) => [`${id}-edit-${market}`, `${id}-edit-card-${market}`];

/** The editor for the positions `held` by the account `owner` (lowercased; null with none connected). */
export function useLevelsEditor(store: ConsoleStore, id: string, owner: string | null, held: readonly HeldPosition[]) {
  const [draft, setDraft] = useState<LevelsDraft | null>(null);
  const [announced, setAnnounced] = useState("");
  // The draft as the handlers last set it, which a save that lands later compares with; written only in handlers and effects.
  const latest = useRef<LevelsDraft | null>(null);
  const opened = useRef(0);
  const set = (next: LevelsDraft | null) => {
    latest.current = next;
    setDraft(next);
  };
  const current = draft !== null && draft.owner === owner && held.some((p) => p.market === draft.market && p.long === draft.long) ? draft : null;
  // A draft whose position closed or turned, or whose account is no longer connected, is dropped while rendering, as React adjusts
  // state on a change of props, so it never shows again; the handlers' copy follows once the drop is committed.
  if (draft !== null && current === null) setDraft(null);
  useEffect(() => {
    if (draft === null) latest.current = null;
  }, [draft]);
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
    /** The draft of `market`'s editor, open for its position on that side; null while it is closed. */
    draftFor: (market: MarketId, long: boolean): LevelsDraft | null => (current?.market === market && current.long === long ? current : null),
    announced,
    /** Opens the editor under `market`'s row with its levels, or closes it there. */
    toggle: (market: MarketId, long: boolean, levels: Levels) => {
      if (owner === null) return;
      store.clearNotice("levels");
      opened.current += 1;
      set(latest.current?.market === market ? null : { market, owner, long, fields: fieldsOf(levels), instance: opened.current });
    },
    edit: (fields: LevelFields) => {
      if (latest.current !== null) set({ ...latest.current, fields });
    },
    cancel: (market: MarketId) => {
      const refocusing = focusInEditor();
      set(null);
      if (refocusing) refocus(market);
    },
    /**
     * A save of `sent` from `instance` landed: says what was saved while that editor is still open, and closes it if it still
     * holds that draft. An editor closed, reopened or dropped since is left alone.
     */
    saved: (instance: number, sent: LevelFields, market: MarketId, words: string) => {
      const now = latest.current;
      if (now === null || now.instance !== instance) return;
      setAnnounced(words);
      if (now.fields !== sent) return;
      const refocusing = focusInEditor();
      set(null);
      if (refocusing) refocus(market);
    },
  };
}
