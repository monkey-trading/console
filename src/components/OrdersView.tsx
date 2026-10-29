"use client";

/** Resting orders with a Cancel button: a table from 1024 px, cards below. */

import { fixedFromWire, formatFixedPlaces } from "@/lib/fixed";
import { cancelOrder } from "@/lib/store/actions";

import { useConsole, useSession } from "./ConsoleProvider";
import { keepFocus } from "./keep-focus";

const TH = "px-4 py-3 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const BUTTON = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";

export function OrdersView() {
  const { account, markets, busy } = useConsole();
  const { store } = useSession();
  if ((account?.orders.length ?? 0) === 0) return <p className="px-4 py-6 text-caption text-fg-3">No resting orders.</p>;
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
  return (
    <>
      <ul className="lg:hidden">
        {rows.map((r) => (
          <li key={r.id} className="border-b border-line px-4 py-3 text-caption last:border-b-0">
            <p className="flex items-center justify-between gap-3">
              <span><span className="text-fg">{r.symbol}</span> <span className={r.buy ? "text-glow" : "text-ember"}>{r.buy ? "Buy" : "Sell"}</span> <span className="text-fg-2 capitalize">{r.type}</span></span>
              <span className="text-fg-3">{r.id}</span>
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-fg-2">
              <div><dt className="text-label text-fg-3">Size</dt><dd>{r.size}</dd></div>
              <div><dt className="text-label text-fg-3">Trigger</dt><dd>{r.trigger}</dd></div>
            </dl>
            <button type="button" disabled={busy} className={`${BUTTON} mt-3 w-full`} aria-label={`Cancel order ${r.id}`} onClick={r.cancel}>Cancel</button>
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
                  <button type="button" disabled={busy} className={BUTTON} aria-label={`Cancel order ${r.id}`} onClick={r.cancel}>Cancel</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
