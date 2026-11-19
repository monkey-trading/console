"use client";

/**
 * The Positions tab's one levels editor: which position it is open under, the fields typed in it, held
 * here so the table's and the cards' editors show the same draft across a change of layout, and what a
 * save says to a screen reader. A draft belongs to the position it was opened for (`openDraft`) and is
 * dropped once that position is no longer the one held, so a later position in the market, a changed one
 * or another account never inherits it. Each opening is a new instance, and a save that lands later closes
 * only the instance and draft it was sent from, returning focus to the row's levels control when it held focus. While an
 * instance's save is signed, sent and its account read back, both its editors hold Save. An editor a live update removes
 * while it holds focus gives focus to the row's levels control too, or to the Positions panel once the row is gone.
 */

import { useEffect, useRef, useState } from "react";

import type { MarketId } from "@/lib/engine/types";
import type { LevelFields } from "@/lib/level-check";
import { landedSave, openDraft, sentFrom, type HeldPosition, type LevelsDraft } from "@/lib/level-draft";
import { levelsWire, type Levels } from "@/lib/levels";
import type { ConsoleStore } from "@/lib/store/store";

/** The fields a position's levels prefill: each as the plain digits it was set with, or empty. */
function fieldsOf(levels: Levels): LevelFields {
  const wire = levelsWire(levels);
  return { takeProfit: wire.take_profit ?? "", stopLoss: wire.stop_loss ?? "" };
}

/** The ids of a row's levels controls, in the table and on the card: a closing editor gives focus back to the one on screen. */
export const levelsControlIds = (id: string, market: MarketId) => [`${id}-levels-control-${market}`, `${id}-levels-control-card-${market}`] as const;

/** The editor for the positions `held` by the account `owner` (lowercased; null with none connected). */
export function useLevelsEditor(store: ConsoleStore, id: string, owner: string | null, held: readonly HeldPosition[]) {
  const [draft, setDraft] = useState<LevelsDraft | null>(null);
  const [announced, setAnnounced] = useState("");
  // The instance whose save is being signed, sent and read back; null with none.
  const [saving, setSaving] = useState<number | null>(null);
  // The draft as the handlers last set it, which a save that lands later compares with; written only in handlers and effects.
  const latest = useRef<LevelsDraft | null>(null);
  const opened = useRef(0);
  // Where focus goes once an editor removed while it held focus has left the page: set as it is removed, taken once committed.
  const dropped = useRef<{ market: MarketId; panel: HTMLElement | null } | null>(null);
  const set = (next: LevelsDraft | null) => {
    latest.current = next;
    setDraft(next);
  };
  const current = openDraft(draft, owner, held);
  // A draft whose position is no longer the one it was opened for, or whose account is no longer connected, is dropped while
  // rendering, as React adjusts state on a change of props, so it never shows again, and one whose position now shows its own
  // save's levels takes them as its base; the handlers' copy follows once committed.
  if (current !== draft) setDraft(current);
  useEffect(() => {
    latest.current = draft;
  }, [draft]);
  /** Whether focus is in the open editor, or was dropped from it: only then does closing move it. */
  const focusInEditor = () => {
    const active = document.activeElement;
    return active === null || active === document.body || active.closest("[data-levels-editor]") !== null;
  };
  /** Focuses `market`'s levels control on screen; false when focus did not land there, as once its row is gone or while it is held. */
  const refocus = (market: MarketId) => {
    const shown = levelsControlIds(id, market).map((key) => document.getElementById(key)).find((el) => el !== null && el.offsetParent !== null);
    shown?.focus();
    return shown !== undefined && document.activeElement === shown;
  };
  // After every commit, as an editor goes with its row or alone: whatever removed it, its row's levels control or the panel takes focus.
  useEffect(() => {
    const target = dropped.current;
    dropped.current = null;
    if (target !== null && !refocus(target.market)) target.panel?.focus();
  });
  return {
    /** The draft of `market`'s editor while it is open; null while it is closed. */
    draftFor: (market: MarketId): LevelsDraft | null => (current?.market === market ? current : null),
    /** Whether `market`'s open editor has a save on its way, its account read included. */
    savingFor: (market: MarketId): boolean => current?.market === market && current.instance === saving,
    /** Whether an editor is open under any row. */
    open: current !== null,
    announced,
    /** Opens the editor under `market`'s row with its levels, or closes it there. */
    toggle: (position: HeldPosition) => {
      if (owner === null) return;
      store.clearNotice("levels");
      opened.current += 1;
      const { market, long, entry, opened: openedAt, levels } = position;
      set(latest.current?.market === market ? null : { market, owner, long, entry, opened: openedAt, base: levels, sent: [], fields: fieldsOf(levels), instance: opened.current });
    },
    edit: (fields: LevelFields) => {
      if (latest.current !== null) set({ ...latest.current, fields });
    },
    /** Editor `instance` sends `levels`, which the position may hold before the answer lands. */
    sending: (instance: number, levels: Levels) => {
      setSaving(instance);
      if (latest.current?.instance === instance) set(sentFrom(latest.current, levels));
    },
    /** Editor `instance`'s save has finished, its account read included, whether or not it was taken. */
    settled: (instance: number) => setSaving((now) => (now === instance ? null : now)),
    cancel: (market: MarketId) => {
      store.clearNotice("levels");
      const refocusing = focusInEditor();
      set(null);
      if (refocusing) refocus(market);
    },
    /** `market`'s editor is being removed while it holds focus, inside `panel`: once it is gone, focus moves on. */
    removedWithFocus: (market: MarketId, panel: HTMLElement | null) => {
      dropped.current = { market, panel };
    },
    /** A save of `sent` from `instance` landed: what it does to the editor open now is `landedSave`'s. */
    saved: (instance: number, sent: LevelFields, market: MarketId, words: string) => {
      const draft = latest.current;
      const outcome = landedSave(draft, instance, sent);
      if (draft === null || outcome === "ignore") return;
      setAnnounced(words);
      if (outcome === "announce") return;
      const refocusing = focusInEditor();
      set(null);
      if (refocusing) refocus(market);
    },
  };
}
