"use client";

/** Resting orders with a Cancel button. */

import { fixedFromWire, formatFixedPlaces } from "@/lib/fixed";
import { cancelOrder } from "@/lib/store/actions";

import { useConsole, useSession } from "./ConsoleProvider";
import { keepFocus } from "./keep-focus";

const TH = "px-4 py-3 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const BUTTON = "rounded border border-line-2 px-2 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40";

export function OrdersView() {
  const { account, markets, busy } = useConsole();
  const { store } = useSession();
  const orders = account?.orders ?? [];
  const symbolOf = (id: number) => markets.find((m) => m.id === id);
  return (
    <div className="overflow-x-auto">
        {orders.length === 0 ? (
          <p className="px-4 py-6 text-caption text-fg-3">No resting orders.</p>
        ) : (
          <table className="w-full min-w-[560px] text-caption">
            <thead><tr className="border-b border-line"><th className={TH}>Order</th><th className={TH}>Market</th><th className={TH}>Side</th><th className={TH}>Type</th><th className={TH}>Size</th><th className={TH}>Trigger</th><th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.order_id} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-4 text-fg-3">{o.order_id}</td>
                  <td className="px-4 py-4 text-fg">{symbolOf(o.market)?.symbol ?? o.market}</td>
                  <td className={`px-4 py-4 ${o.side === "buy" ? "text-glow" : "text-ember"}`}>{o.side === "buy" ? "Buy" : "Sell"}</td>
                  <td className="px-4 py-4 capitalize">{o.kind.type}</td>
                  <td className="px-4 py-4">{formatFixedPlaces(fixedFromWire(o.qty), 6)}</td>
                  <td className="px-4 py-4">{o.kind.type === "market" ? "—" : formatFixedPlaces(fixedFromWire(o.kind.price), symbolOf(o.market)?.places ?? 2)}</td>
                  <td className="px-4 py-4 text-right">
                    <button type="button" disabled={busy} className={BUTTON} aria-label={`Cancel order ${o.order_id}`} onClick={(event) => { keepFocus(event.currentTarget); void cancelOrder(store, o.order_id); }}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
  );
}
