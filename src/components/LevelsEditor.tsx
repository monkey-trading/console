"use client";

/**
 * The modal dialog a position's levels control opens (from V79): its take profit and stop loss, prefilled with the levels it
 * holds, checked against the price at which the whole position would close, and saved, moved or removed in one
 * session-signed request. A centred dialog from 1024 px, a full-screen sheet below. The draft is the Positions tab's
 * (`useLevelsEditor`), and the dialog follows the position as it changes size or side.
 */

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef } from "react";

import { spokenRate } from "@/lib/fee-words";
import type { Fixed } from "@/lib/fixed";
import { checkEditorLevels, type LevelFields } from "@/lib/level-check";
import { LEVELS_HELP, levelsSavedWords } from "@/lib/level-words";
import { NO_LEVELS, type Levels } from "@/lib/levels";
import type { MarketModel, PositionModel } from "@/lib/models";
import { formatMark } from "@/lib/price-format";
import { setPositionLevels } from "@/lib/store/level-actions";
import type { TicketLimits } from "@/lib/tier-view";

import { useConsoleValue, useSession } from "./ConsoleProvider";
import { LevelInputs } from "./LevelInputs";
import { Notice } from "./Notice";

interface Props {
  market: MarketModel;
  position: PositionModel;
  /** The draft typed in the dialog, and what replaces it. */
  fields: LevelFields;
  onChange: (fields: LevelFields) => void;
  /** What closing the whole position fills at now, or null with `noClosing` saying why; and the mark while that close is the console's estimate, which a take profit is measured from instead. */
  closing: Fixed | null;
  noClosing: string;
  capped: Fixed | null;
  limits: TicketLimits | null;
  toUsdDown: ((amount: Fixed) => Fixed) | null;
  /** Closes the dialog without saving: Cancel, or Escape. */
  onCancel: () => void;
  /** Save sends `levels`. */
  onSend: (levels: Levels) => void;
  /** The node took `sent`, and `words` say what the position now holds. */
  onSaved: (sent: LevelFields, words: string) => void;
  /** Whether this dialog's own save is being signed, sent and read back, which alone its Save button says; and what ends it. */
  saving: boolean;
  onSettled: () => void;
  readOnly: boolean;
  /** Why Save is unavailable to this session, as the row's Close button says it. */
  describedBy: string | undefined;
  /** The `dialog` is being removed while it holds focus, inside `panel`, its tab panel. */
  onRemovedWithFocus: (market: MarketModel["id"], dialog: HTMLElement, panel: HTMLElement | null) => void;
  /** What a save of this dialog's said while it stayed open, read out from inside it. */
  announced: string;
}

const BUTTON = "min-h-11 rounded border px-4 py-1.5 text-caption focus-visible:outline-2 focus-visible:outline-glow";
/** A full-screen sheet on a phone; from 1024 px, a dialog centred over the page. */
const SHEET = "m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto bg-ink-1 p-0 text-fg backdrop:bg-ink/70 lg:m-auto lg:h-fit lg:max-h-[calc(100dvh-2rem)] lg:w-[calc(100%-2rem)] lg:max-w-md lg:rounded-xl lg:border lg:border-line-2";

export function LevelsEditor({ market, position, fields, onChange, closing, noClosing, capped, limits, toUsdDown, onCancel, onSend, onSaved, saving, onSettled, readOnly, describedBy, onRemovedWithFocus, announced }: Props) {
  const { store } = useSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const help = useId();
  const removedWithFocus = useEffectEvent((element: HTMLElement) => onRemovedWithFocus(market.id, element, element.closest<HTMLElement>('[role="tabpanel"]')));
  // Opens modal, with focus in the take profit field. A layout cleanup runs while the dialog is still on the page, so it can tell whether
  // focus was in it, or dropped to the page, as it goes.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (!element.open) {
      element.showModal();
      element.querySelector("input")?.focus();
    }
    return () => {
      const active = document.activeElement;
      if (active === null || active === document.body || element.contains(active)) removedWithFocus(element);
    };
  }, []);
  // Tab from the last control, or Shift+Tab from the first, wraps within the dialog rather than leaving it for the browser's own controls.
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(element.querySelectorAll<HTMLElement>("input, button:not([disabled])"));
      const [first, last] = [controls[0], controls.at(-1)];
      if (first === undefined || last === undefined || document.activeElement !== (event.shiftKey ? first : last)) return;
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    };
    element.addEventListener("keydown", onKey);
    return () => element.removeEventListener("keydown", onKey);
  }, []);
  const busy = useConsoleValue((state) => state.busy);
  // The field a refusal names, under which the dialog's notice shows; with none, it shows under the buttons.
  const refusedAt = useConsoleValue((state) => state.notices.levels?.field ?? null);
  const long = position.qty > 0n;
  const check = checkEditorLevels({ market, qty: position.qty, entry: position.entry, held: position.levels ?? NO_LEVELS, closing, noClosing, capped, limits, fields, toUsdDown });
  // The session's busy flag clears once the node answers; the save holds Save until its account read has landed too.
  const canSave = check.changed && !check.blocked && !busy && !saving && !readOnly;
  const rate = spokenRate(market.view.min_level_distance_bps ?? 0);
  const save = () => {
    if (!canSave) return;
    const sent = fields;
    const words = levelsSavedWords(market.symbol, check.named, market.places);
    onSend(check.named);
    void setPositionLevels(store, market.id, check.named).then((saved) => {
      onSettled();
      if (saved) onSaved(sent, words);
    });
  };
  // While a request is signed and sent, Escape does nothing, as Cancel does; the browser may still close it on a second Escape.
  const cancel = () => {
    if (!busy) onCancel();
  };
  return (
    <dialog ref={dialog} aria-modal="true" aria-labelledby={title} aria-describedby={help} className={SHEET}
      onCancel={(event) => { event.preventDefault(); cancel(); }} onClose={onCancel}>
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <h2 id={title} className="border-b border-line px-4 py-2 text-label tracking-caps text-glow uppercase">Take profit and stop loss · {market.symbol} {long ? "long" : "short"}</h2>
        <div className="px-4 pb-4">
          <p id={help} className="mt-3 text-caption leading-relaxed text-fg-2">{LEVELS_HELP}</p>
          <LevelInputs title={`Take profit and stop loss for your ${market.symbol} ${long ? "long" : "short"} position`} check={check} fields={fields} onChange={onChange} dialog={{ notice: <Notice surface="levels" />, at: refusedAt }} />
          {closing !== null && <p className="mt-2 text-label leading-relaxed text-fg-3">The price at which your entire position would close is currently {capped === null ? "" : "estimated at "}{formatMark(closing, market.places)}{capped === null ? "" : `, and the market price is ${formatMark(capped, market.places)}`}. {capped === null
            ? `A new or moved take profit must be at least ${rate} ${long ? "above" : "below"} that closing price, and a new or moved stop loss at least ${rate} ${long ? "below" : "above"} it.`
            : `A new or moved stop loss must be at least ${rate} ${long ? "below" : "above"} that closing price, and a new or moved take profit at least ${rate} ${long ? "above" : "below"} the market price.`}</p>}
          <div className="mt-4 flex gap-2">
            <button type="submit" aria-disabled={!canSave} aria-describedby={describedBy} className={`${BUTTON} border-glow bg-glow/10 text-glow hover:bg-glow/20 aria-disabled:cursor-not-allowed aria-disabled:opacity-40`}>{saving ? "Signing…" : "Save"}</button>
            <button type="button" disabled={busy} className={`${BUTTON} border-line-2 text-fg-2 hover:border-glow hover:text-glow disabled:opacity-40`} onClick={cancel}>Cancel</button>
          </div>
          {refusedAt === null && <Notice surface="levels" />}
          <p role="status" className="sr-only">{announced}</p>
        </div>
      </form>
    </dialog>
  );
}
