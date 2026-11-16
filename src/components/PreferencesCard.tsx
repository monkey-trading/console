"use client";

/** The trading preferences: each one is stored in this browser and read at once by what it controls (the ticket, the batch buttons, the chart). */

import { useId, type ReactNode } from "react";

import { CONFIRM_MS } from "@/lib/confirm-window";
import { ORDER_LABELS, ORDER_TYPES, type SizePreference } from "@/lib/prefs";
import { SLIPPAGE_CHOICES } from "@/lib/ticket";

import { useSession } from "./ConsoleProvider";
import { usePrefs } from "./use-prefs";

const CHOICE = "min-h-11 rounded border py-2.5 text-caption focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0";
const picked = (on: boolean) => (on ? "border-glow bg-glow/10 text-glow" : "border-line-2 text-fg-2");

const SIZE_CHOICES: readonly { value: SizePreference; label: string }[] = [
  { value: "minimum", label: "Market minimum" },
  { value: "last", label: "Last size used" },
];

/** A row of buttons of which exactly one is pressed, like the deal ticket's. */
function Choice<T extends string | number>({ legend, note, options, value, onPick, columns }: { legend: string; note: ReactNode; options: readonly { value: T; label: string }[]; value: T; onPick: (value: T) => void; columns: string }) {
  const noteId = useId();
  return (
    <fieldset aria-describedby={noteId} className="mt-5">
      <legend className="text-caption text-fg-2">{legend}</legend>
      <div className={`mt-2 grid gap-2 ${columns}`}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onPick(o.value)} className={`${CHOICE} ${picked(value === o.value)}`}>{o.label}</button>
        ))}
      </div>
      <p id={noteId} className="mt-2 text-label leading-relaxed text-fg-3">{note}</p>
    </fieldset>
  );
}

/** An on/off preference as a switch. */
function Switch({ label, note, on, onChange }: { label: string; note: string; on: boolean; onChange: (on: boolean) => void }) {
  const noteId = useId();
  return (
    <div className="mt-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-caption text-fg-2">{label}</p>
        <p id={noteId} className="mt-1 text-label leading-relaxed text-fg-3">{note}</p>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={`${on ? "On" : "Off"}: ${label}`} aria-describedby={noteId} onClick={() => onChange(!on)} className={`${CHOICE} w-20 shrink-0 ${picked(on)}`}>{on ? "On" : "Off"}</button>
    </div>
  );
}

export function PreferencesCard() {
  const { prefs: store } = useSession();
  const { prefs, saved } = usePrefs();
  return (
    <section aria-labelledby="preferences-title" className="rounded-xl border border-line-2 bg-ink-1 p-4 sm:p-5">
      <h3 id="preferences-title" className="text-label tracking-caps text-fg-3 uppercase">Trading preferences</h3>
      <p className="mt-2 text-caption leading-relaxed text-fg-3">These preferences are stored in this browser only and set the defaults of the deal ticket. Changing them does not alter an order you are already preparing.</p>
      <p role="status" className="mt-2 text-caption text-amber">{saved ? "" : "This browser does not allow the preferences to be stored, so your changes apply only until you close or reload the page."}</p>
      <Choice legend="Default order type" columns="grid-cols-3" value={prefs.orderType} onPick={(value) => store.set("orderType", value)} options={ORDER_TYPES.map((value) => ({ value, label: ORDER_LABELS[value] }))}
        note="The order type selected when the deal ticket opens in any market. You can still choose a different order type on the ticket before you place an order." />
      <Choice legend="Default max slippage" columns="grid-cols-2 sm:grid-cols-4" value={prefs.slippageBps} onPick={(value) => store.set("slippageBps", value)} options={SLIPPAGE_CHOICES.map((bps) => ({ value: bps, label: `${bps} bps` }))}
        note="In a fast-moving market, the execution price of a market order may be worse than the price quoted on screen. Restricting the maximum slippage means orders that would fill at an adverse price are rejected." />
      <Choice legend="Default size" columns="grid-cols-1 min-[400px]:grid-cols-2" value={prefs.size} onPick={(value) => store.set("size", value)} options={SIZE_CHOICES}
        note="The order size the deal ticket opens with. The ticket remembers the last size you traded in each market, and raises it to the market's minimum order size if that minimum has since increased." />
      <Switch label="Ask before Cancel all and Close all" on={prefs.confirmBatch} onChange={(on) => store.set("confirmBatch", on)}
        note={`When enabled, Cancel all and Close all must be pressed a second time within ${CONFIRM_MS / 1000} seconds before the instruction is sent. When disabled, a single press sends it immediately.`} />
      <Switch label="Show entry and order lines on the chart" on={prefs.chartLines} onChange={(on) => store.set("chartLines", on)}
        note="Displays your entry price and the levels of your working orders on the chart. The close-out level is always displayed." />
    </section>
  );
}
