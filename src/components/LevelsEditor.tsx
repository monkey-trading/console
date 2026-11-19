"use client";

/**
 * The editor a position's levels control opens under its row (from V79): its take profit and stop
 * loss, prefilled with the levels it holds, checked against the price at which the whole position would
 * close, and saved, moved or removed in one session-signed request. The draft is the Positions tab's
 * (`useLevelsEditor`), so the table's and the card's editors are one.
 */

import { useEffectEvent, useLayoutEffect, useRef } from "react";

import { spokenRate } from "@/lib/fee-words";
import type { Fixed } from "@/lib/fixed";
import { checkEditorLevels, type LevelFields } from "@/lib/level-check";
import { levelsSavedWords } from "@/lib/level-words";
import { NO_LEVELS, type Levels } from "@/lib/levels";
import type { MarketModel, PositionModel } from "@/lib/models";
import { formatMark } from "@/lib/price-format";
import { setPositionLevels } from "@/lib/store/level-actions";
import type { TicketLimits } from "@/lib/tier-view";

import { useConsoleValue, useSession } from "./ConsoleProvider";
import { LevelInputs } from "./LevelInputs";
import { Notice } from "./Notice";

const BUTTON = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:opacity-40 lg:min-h-0 lg:px-2";

interface Props {
  id: string;
  market: MarketModel;
  position: PositionModel;
  /** The draft typed in the editor, and what replaces it. */
  fields: LevelFields;
  onChange: (fields: LevelFields) => void;
  /** What closing the whole position fills at now, or null with `noClosing` saying why; and the mark while that close is the console's estimate, which a take profit is measured from instead. */
  closing: Fixed | null;
  noClosing: string;
  capped: Fixed | null;
  limits: TicketLimits | null;
  toUsdDown: ((amount: Fixed) => Fixed) | null;
  onCancel: () => void;
  /** Save sends `levels`. */
  onSend: (levels: Levels) => void;
  /** The node took `sent`, and `words` say what the position now holds. */
  onSaved: (sent: LevelFields, words: string) => void;
  /** Whether this editor's own save is being signed, sent and read back, which alone its Save button says; and what ends it. */
  saving: boolean;
  onSettled: () => void;
  readOnly: boolean;
  /** Why Save is unavailable to this session, as the row's Close button says it. */
  describedBy: string | undefined;
  /** The editor is being removed while it holds focus, inside `panel`, its tab panel. */
  onRemovedWithFocus: (market: MarketModel["id"], panel: HTMLElement | null) => void;
}

export function LevelsEditor({ id, market, position, fields, onChange, closing, noClosing, capped, limits, toUsdDown, onCancel, onSend, onSaved, saving, onSettled, readOnly, describedBy, onRemovedWithFocus }: Props) {
  const { store } = useSession();
  const form = useRef<HTMLFormElement>(null);
  const removedWithFocus = useEffectEvent((panel: HTMLElement | null) => onRemovedWithFocus(market.id, panel));
  // A layout cleanup runs while the form is still on the page, so it can tell whether the form held focus as it goes.
  useLayoutEffect(() => {
    const element = form.current;
    return () => {
      if (element !== null && element.contains(document.activeElement)) removedWithFocus(element.closest<HTMLElement>('[role="tabpanel"]'));
    };
  }, []);
  const busy = useConsoleValue((state) => state.busy);
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
  return (
    <form ref={form} id={id} data-levels-editor className="px-4 py-3 lg:px-1.5" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <LevelInputs title={`Take profit and stop loss for your ${market.symbol} ${long ? "long" : "short"} position`} check={check} fields={fields} onChange={onChange} />
      {closing !== null && <p className="mt-1 text-label leading-relaxed text-fg-3">The price at which your entire position would close is currently {capped === null ? "" : "estimated at "}{formatMark(closing, market.places)}{capped === null ? "" : `, and the market price is ${formatMark(capped, market.places)}`}. {capped === null
        ? `A new or moved take profit must be at least ${rate} ${long ? "above" : "below"} that closing price, and a new or moved stop loss at least ${rate} ${long ? "below" : "above"} it.`
        : `A new or moved stop loss must be at least ${rate} ${long ? "below" : "above"} that closing price, and a new or moved take profit at least ${rate} ${long ? "above" : "below"} the market price.`}</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" aria-disabled={!canSave} aria-describedby={describedBy} className={BUTTON}>{saving ? "Signing…" : "Save"}</button>
        <button type="button" disabled={busy} className={`${BUTTON} disabled:opacity-40`} onClick={onCancel}>Cancel</button>
      </div>
      <Notice surface="levels" />
    </form>
  );
}
