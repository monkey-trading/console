"use client";

/** Resting orders with a Cancel button each and a Cancel all above them: a table from 1024 px, cards below. */

import { useEffect, useId } from "react";

import { pressBatch } from "@/lib/close-all";
import { CONFIRM_MIN_GAP_MS, CONFIRM_MS } from "@/lib/confirm-window";
import { fixedFromWire, formatFixedPlaces } from "@/lib/fixed";
import { cancelOrder } from "@/lib/store/actions";
import { cancelAll } from "@/lib/store/batch-actions";

import { useConsole, useSession } from "./ConsoleProvider";
import { keepFocus } from "./keep-focus";
import { useReadOnlyNote } from "./SignGate";
import { useConfirmWindow } from "./use-confirm-window";
import { usePrefs } from "./use-prefs";

const TH = "px-4 py-3 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const BUTTON = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";

/** The button while it waits for its second press: the hover colours, held. */
const ARMED = "min-h-11 rounded border border-glow px-3 py-1 text-caption text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";

export function OrdersView() {
  const { account, markets, busy } = useConsole();
  const { store } = useSession();
  const readOnly = useReadOnlyNote(useId(), "Cancel");
  const count = account?.orders.length ?? 0;
  const { armed, state, arm, cancel } = useConfirmWindow(CONFIRM_MS, CONFIRM_MIN_GAP_MS);
  const { confirmBatch } = usePrefs().prefs;
  // The window confirms the count it was armed for: when an order rests or goes, it closes and the next press arms again.
  useEffect(() => cancel(), [count, cancel]);
  if (count === 0) return <p className="px-4 py-6 text-caption text-fg-3">No resting orders.</p>;
  const rows = (account?.orders ?? []).map((o) => {
    const market = markets.find((m) => m.id === o.market);
    return {
      id: o.order_id,
      symbol: String(market?.symbol ?? o.market),
      buy: o.side === "buy",
      type: o.kind.kind,
      size: formatFixedPlaces(fixedFromWire(o.qty), 6),
      trigger: o.kind.kind === "market" ? "—" : formatFixedPlaces(fixedFromWire(o.kind.price), market?.places ?? 2),
      cancel: (event: { currentTarget: HTMLElement }) => { keepFocus(event.currentTarget); void cancelOrder(store, o.order_id); },
    };
  });
  const confirming = armed && count > 0;
  const cancelEverything = (event: { currentTarget: HTMLElement }) => {
    const press = pressBatch(confirmBatch, state(), count);
    if (press === "arm") arm();
    if (press !== "send") return;
    cancel();
    keepFocus(event.currentTarget);
    void cancelAll(store);
  };
  // A held Enter repeats its click: only a separate press may confirm.
  const holdsDown = (event: { repeat: boolean; preventDefault: () => void }) => { if (event.repeat) event.preventDefault(); };
  const noun = count === 1 ? "order" : "orders";
  return (
    <>
      {readOnly.note}
      <div className="border-b border-line px-4 py-3 lg:py-2">
        {/* One signature and one request for every resting order in every market; the second press is the Settings preference. */}
        <button type="button" disabled={busy || readOnly.readOnly} className={`${confirming ? ARMED : BUTTON} w-full lg:w-auto`} aria-describedby={readOnly.describedBy} onClick={cancelEverything} onKeyDown={holdsDown}>
          {confirming ? `Confirm: cancel ${count} ${noun}` : `Cancel all (${count})`}
        </button>
        <p role="status" className="sr-only">{confirming ? `Press again within five seconds to cancel ${count} ${noun}.` : ""}</p>
      </div>
      <ul className="lg:hidden">
        {rows.map((r) => (
          <li key={r.id} className="border-b border-line px-4 py-3 text-caption last:border-b-0">
            <p className="flex items-center justify-between gap-3">
              <span><span className="text-fg">{r.symbol}</span> <span className={r.buy ? "text-glow" : "text-ember"}>{r.buy ? "Buy" : "Sell"}</span> <span className="text-fg-2 capitalize">{r.type}</span></span>
              <span className="text-fg-3">Order {r.id}</span>
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-fg-2">
              <div><dt className="text-label text-fg-3">Size</dt><dd>{r.size}</dd></div>
              <div><dt className="text-label text-fg-3">Trigger</dt><dd>{r.trigger}</dd></div>
            </dl>
            <button type="button" disabled={busy || readOnly.readOnly} className={`${BUTTON} mt-3 w-full`} aria-label={`Cancel order ${r.id}`} aria-describedby={readOnly.describedBy} onClick={r.cancel}>Cancel</button>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[560px] text-caption">
          <thead><tr className="border-b border-line"><th className={TH}>Order</th><th className={TH}>Market</th><th className={TH}>Side</th><th className={TH}>Type</th><th className={TH}>Size</th><th className={TH}>Trigger</th><th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-b-0">
                <td className="px-4 py-4 text-fg-3">{r.id}</td>
                <td className="px-4 py-4 text-fg">{r.symbol}</td>
                <td className={`px-4 py-4 ${r.buy ? "text-glow" : "text-ember"}`}>{r.buy ? "Buy" : "Sell"}</td>
                <td className="px-4 py-4 capitalize">{r.type}</td>
                <td className="px-4 py-4">{r.size}</td>
                <td className="px-4 py-4">{r.trigger}</td>
                <td className="px-4 py-4 text-right">
                  <button type="button" disabled={busy || readOnly.readOnly} className={BUTTON} aria-label={`Cancel order ${r.id}`} aria-describedby={readOnly.describedBy} onClick={r.cancel}>Cancel</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
