"use client";

/**
 * The editor an open position's Edit button opens under its row (from V79): its take profit and stop
 * loss, prefilled with the levels it holds, checked against the price at which the whole position would
 * close, and saved, moved or removed in one session-signed request. One editor is open at a time.
 */

import { useState } from "react";

import { spokenRate } from "@/lib/fee-words";
import type { Fixed } from "@/lib/fixed";
import { checkEditorLevels, type LevelFields } from "@/lib/level-check";
import { EDITOR_LEVELS_NOTE } from "@/lib/level-words";
import { levelsWire, NO_LEVELS, type Levels } from "@/lib/levels";
import type { MarketModel, PositionModel } from "@/lib/models";
import { formatMark } from "@/lib/price-format";
import { setPositionLevels } from "@/lib/store/level-actions";
import type { TicketLimits } from "@/lib/tier-view";

import { useConsoleValue, useSession } from "./ConsoleProvider";
import { LevelInputs } from "./LevelInputs";
import { Notice } from "./Notice";

const BUTTON = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:opacity-40 lg:min-h-0 lg:px-2";

/** The fields a position's levels prefill: each as the plain digits it was set with, or empty. */
function fieldsOf(levels: Levels): LevelFields {
  const wire = levelsWire(levels);
  return { takeProfit: wire.take_profit ?? "", stopLoss: wire.stop_loss ?? "" };
}

interface Props {
  id: string;
  market: MarketModel;
  position: PositionModel;
  /** What closing the whole position fills at now, or null with `noClosing` saying why. */
  closing: Fixed | null;
  noClosing: string;
  limits: TicketLimits | null;
  toUsdDown: ((amount: Fixed) => Fixed) | null;
  /** Closes the editor; called once the levels are saved. */
  onDone: () => void;
  readOnly: boolean;
}

export function LevelsEditor({ id, market, position, closing, noClosing, limits, toUsdDown, onDone, readOnly }: Props) {
  const { store } = useSession();
  const busy = useConsoleValue((state) => state.busy);
  const held = position.levels ?? NO_LEVELS;
  const [fields, setFields] = useState<LevelFields>(() => fieldsOf(held));
  const long = position.qty > 0n;
  const check = checkEditorLevels({ market, qty: position.qty, entry: position.entry, held, closing, noClosing, limits, fields, toUsdDown });
  const canSave = check.changed && !check.blocked && !busy && !readOnly;
  const rate = spokenRate(market.view.min_level_distance_bps ?? 0);
  const save = () => {
    if (!canSave) return;
    void setPositionLevels(store, market.id, check.named).then((saved) => { if (saved) onDone(); });
  };
  return (
    <form id={id} className="px-4 py-3 lg:px-1.5" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <LevelInputs title={`Take profit and stop loss for your ${market.symbol} ${long ? "long" : "short"} position`} check={check} fields={fields} onChange={setFields} note={EDITOR_LEVELS_NOTE} />
      {closing !== null && <p className="mt-1 text-label leading-relaxed text-fg-3">The price at which your entire position would close is currently {formatMark(closing, market.places)}. A new or moved take profit must be at least {rate} {long ? "above" : "below"} that closing price, and a new or moved stop loss at least {rate} {long ? "below" : "above"} it.</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" aria-disabled={!canSave} className={BUTTON}>{busy ? "Signing…" : "Save"}</button>
        <button type="button" className={BUTTON} onClick={onDone}>Cancel</button>
      </div>
      <Notice surface="levels" />
    </form>
  );
}
