"use client";

/**
 * The Positions tab's one levels dialog: which position it is open for, the fields typed in it, and what a save
 * says to a screen reader. A draft belongs to the account and market it was opened for (`openDraft`): it stays
 * open while that account holds a position there, whatever its size or side, and is dropped once it does not,
 * the panel saying why when the position closed. Each opening is a new instance, and a save that lands later closes
 * only the instance and draft it was sent from. While an instance's save is signed, sent and its account read back,
 * its Save is held. However the dialog goes, focus returns to the position's levels control, or to the Positions
 * panel once the position is gone or while the control is unavailable.
 */

import { useEffect, useRef, useState } from "react";

import type { MarketId } from "@/lib/engine/types";
import type { LevelFields } from "@/lib/level-check";
import { dialogAnnouncement, fieldsOf, landedSave, openDraft, positionClosed, sentFrom, type HeldPosition, type LevelsDraft, type SaveWords } from "@/lib/level-draft";
import { levelsDialogClosedWords } from "@/lib/level-words";
import type { Levels } from "@/lib/levels";
import type { ConsoleStore } from "@/lib/store/store";

/** The ids of a position's levels controls, in the table and on the card: a closing dialog gives focus back to the one on screen. */
export const levelsControlIds = (id: string, market: MarketId) => [`${id}-levels-control-${market}`, `${id}-levels-control-card-${market}`] as const;

/** The dialog for the positions `held` by the account `owner` (lowercased; null with none connected). */
export function useLevelsEditor(store: ConsoleStore, id: string, owner: string | null, held: readonly HeldPosition[]) {
  const [draft, setDraft] = useState<LevelsDraft | null>(null);
  // The last save's words, which the panel reads out, and the dialog that sent it while it stays open.
  const [announced, setAnnounced] = useState<SaveWords | null>(null);
  // The instance whose save is being signed, sent and read back; null with none.
  const [saving, setSaving] = useState<number | null>(null);
  // The last draft dropped because the account no longer holds its position, which the panel's notice names once.
  const [closed, setClosed] = useState<LevelsDraft | null>(null);
  const said = useRef<LevelsDraft | null>(null);
  // The draft as the handlers last set it, which a save that lands later compares with; written only in handlers and effects.
  const latest = useRef<LevelsDraft | null>(null);
  const opened = useRef(0);
  // Where focus goes once a dialog removed while it held focus has left the page: set as it is removed, taken once committed.
  const dropped = useRef<{ market: MarketId; dialog: HTMLElement; panel: HTMLElement | null } | null>(null);
  const set = (next: LevelsDraft | null) => {
    latest.current = next;
    setDraft(next);
  };
  const current = openDraft(draft, owner, held);
  // A draft whose position has closed, or whose account is no longer connected, is dropped while rendering, as React adjusts state on a
  // change of props, so it never shows again; one whose position's levels changed takes them as its base. The handlers' copy follows once committed.
  if (current !== draft) {
    setDraft(current);
    if (current === null && draft !== null && positionClosed(draft, owner, held)) setClosed(draft);
  }
  useEffect(() => {
    latest.current = draft;
  }, [draft]);
  useEffect(() => {
    if (closed === null || said.current === closed) return;
    said.current = closed;
    const symbol = store.getSnapshot().markets.find((m) => m.id === closed.market)?.symbol ?? `market ${closed.market}`;
    store.notify("levels", levelsDialogClosedWords(symbol), "info");
  }, [closed, store]);
  /** Focuses `market`'s levels control on screen; false when focus did not land there, as once its row is gone or while it is held. */
  const refocus = (market: MarketId) => {
    const shown = levelsControlIds(id, market).map((key) => document.getElementById(key)).find((el) => el !== null && el.offsetParent !== null);
    shown?.focus();
    return shown !== undefined && document.activeElement === shown;
  };
  // After every commit: a dialog that has left the page while it held focus hands it to its position's levels control, or the panel. One
  // still on the page was not removed, as when StrictMode rehearses an unmount in development.
  useEffect(() => {
    const target = dropped.current;
    dropped.current = null;
    if (target === null || target.dialog.isConnected) return;
    if (!refocus(target.market)) target.panel?.focus();
  });
  return {
    /** The draft of `market`'s dialog while it is open; null while it is closed. */
    draftFor: (market: MarketId): LevelsDraft | null => (current?.market === market ? current : null),
    /** Whether `market`'s open dialog has a save on its way, its account read included. */
    savingFor: (market: MarketId): boolean => current?.market === market && current.instance === saving,
    /** Whether the dialog is open for any position. */
    open: current !== null,
    announced: announced?.text ?? "",
    /** What `market`'s open dialog reads out of its own save, which the panel behind it cannot while it is open. */
    announcedFor: (market: MarketId): string => (current?.market === market ? dialogAnnouncement(current, announced) : ""),
    /** Opens the dialog for `position`, with its levels. */
    openFor: (position: HeldPosition) => {
      if (owner === null) return;
      store.clearNotice("levels");
      opened.current += 1;
      set({ market: position.market, owner, base: position.levels, sent: [], fields: fieldsOf(position.levels), instance: opened.current });
    },
    edit: (fields: LevelFields) => {
      if (latest.current !== null) set({ ...latest.current, fields });
    },
    /** Dialog `instance` sends `levels`, which the position may hold before the answer lands. */
    sending: (instance: number, levels: Levels) => {
      setSaving(instance);
      if (latest.current?.instance === instance) set(sentFrom(latest.current, levels));
    },
    /** Dialog `instance`'s save has finished, its account read included, whether or not it was taken. */
    settled: (instance: number) => setSaving((now) => (now === instance ? null : now)),
    /** Closes the dialog without saving. */
    cancel: () => {
      store.clearNotice("levels");
      set(null);
    },
    /** `market`'s `dialog` is being removed while it holds focus, inside `panel`: once it is gone, focus moves on. */
    removedWithFocus: (market: MarketId, dialog: HTMLElement, panel: HTMLElement | null) => {
      dropped.current = { market, dialog, panel };
    },
    /** A save of `sent` from `instance` landed: what it does to the dialog open now is `landedSave`'s. */
    saved: (instance: number, sent: LevelFields, words: string) => {
      const outcome = landedSave(latest.current, instance, sent);
      if (outcome === "ignore") return;
      setAnnounced({ text: words, instance });
      if (outcome === "close") set(null);
    },
  };
}
