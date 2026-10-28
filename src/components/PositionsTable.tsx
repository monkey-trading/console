"use client";

/** Open positions with their profit and loss, and resting orders with a cancel. */

import { formatPrice } from "@/lib/price-format";
import { absFixed, fixedToNumber, formatFixedPlaces, mulFixed, type Fixed } from "@/lib/fixed";
import { cancelOrder, placeOrder } from "@/lib/store/actions";

import { useConsole, useSession } from "./ConsoleProvider";

const TH = "px-4 py-3 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const BUTTON = "rounded border border-line-2 px-2 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40";

export function PositionsView() {
  const { account, markets, busy } = useConsole();
  const { store } = useSession();
  const positions = account?.positions ?? [];
  const symbolOf = (id: number) => markets.find((m) => m.id === id);
  return (
    <div className="overflow-x-auto">
        {positions.length === 0 ? (
          <p className="px-4 py-6 text-caption text-fg-3">No open positions.</p>
        ) : (
          <table className="w-full min-w-[640px] text-caption">
            <thead><tr className="border-b border-line"><th className={TH}>Market</th><th className={TH}>Side</th><th className={TH}>Size</th><th className={TH}>Entry</th><th className={TH}>Mark</th><th className={TH}>P&amp;L</th><th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {positions.map((p) => {
                const market = symbolOf(p.market);
                const mark = market?.mark ?? p.entry;
                const pnl: Fixed = mulFixed(p.qty, mark - p.entry);
                const places = market?.places ?? 2;
                return (
                  <tr key={p.market} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-4 text-fg">{market?.symbol ?? p.market}</td>
                    <td className={`px-4 py-4 ${p.qty > 0n ? "text-glow" : "text-alarm"}`}>{p.qty > 0n ? "Long" : "Short"}</td>
                    <td className="px-4 py-4">{formatFixedPlaces(absFixed(p.qty), 6)}</td>
                    <td className="px-4 py-4">{formatPrice(fixedToNumber(p.entry), places)}</td>
                    <td className="px-4 py-4">{formatPrice(fixedToNumber(mark), places)}</td>
                    <td className={`px-4 py-4 ${pnl < 0n ? "text-alarm" : "text-glow"}`}>${formatFixedPlaces(pnl, 2)}</td>
                    <td className="px-4 py-4 text-right">
                      <button type="button" disabled={busy || !market?.open} className={BUTTON} aria-label={`Close ${market?.symbol ?? ""} position`}
                        onClick={() => void placeOrder(store, { market: p.market, side: p.qty > 0n ? "sell" : "buy", notional: absFixed(mulFixed(p.qty, mark)), slippageBps: 25, kind: { type: "market" }, reduceOnly: true, qty: absFixed(p.qty) })}>
                        Close
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
  );
}

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
                  <td className={`px-4 py-4 ${o.side === "buy" ? "text-glow" : "text-alarm"}`}>{o.side === "buy" ? "Buy" : "Sell"}</td>
                  <td className="px-4 py-4 capitalize">{o.kind.type}</td>
                  <td className="px-4 py-4">{o.qty}</td>
                  <td className="px-4 py-4">{o.kind.type === "market" ? "—" : o.kind.price}</td>
                  <td className="px-4 py-4 text-right">
                    <button type="button" disabled={busy} className={BUTTON} aria-label={`Cancel order ${o.order_id}`} onClick={() => void cancelOrder(store, o.order_id)}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
  );
}
