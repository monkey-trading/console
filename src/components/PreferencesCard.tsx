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
      <p className="mt-2 text-caption leading-relaxed text-fg-3">Kept in this browser only. They set where the deal ticket starts; anything you have already chosen or typed on the ticket stays as it is.</p>
      <p role="status" className="mt-2 text-caption text-amber">{saved ? "" : "This browser would not store them, so they last until you close or reload the page."}</p>
      <Choice legend="Default order type" columns="grid-cols-3" value={prefs.orderType} onPick={(value) => store.set("orderType", value)} options={ORDER_TYPES.map((value) => ({ value, label: ORDER_LABELS[value] }))}
        note="The ticket opens on this type for each market." />
      <Choice legend="Default slippage bound" columns="grid-cols-2 sm:grid-cols-4" value={prefs.slippageBps} onPick={(value) => store.set("slippageBps", value)} options={SLIPPAGE_CHOICES.map((bps) => ({ value: bps, label: `${bps} bps` }))}
        note="Market orders are declined if the live price is worse than the quote by more than this. A market whose own maximum is lower uses that." />
      <Choice legend="Default size" columns="grid-cols-1 min-[400px]:grid-cols-2" value={prefs.size} onPick={(value) => store.set("size", value)} options={SIZE_CHOICES}
        note="Where the size field starts. The last size used is kept for each market, and is raised to the market's minimum if that has risen since." />
      <Switch label="Ask before Cancel all and Close all" on={prefs.confirmBatch} onChange={(on) => store.set("confirmBatch", on)}
        note={`On, the button asks for a second press within ${CONFIRM_MS / 1000} seconds. Off, one press sends the request.`} />
      <Switch label="Show entry and order lines on the chart" on={prefs.chartLines} onChange={(on) => store.set("chartLines", on)}
        note="Your position's entry price and your resting orders. The close-out estimate always shows." />
    </section>
  );
}
