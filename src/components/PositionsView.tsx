"use client";

/** Open positions with their profit and loss and a Close button. */

import { formatPrice } from "@/lib/price-format";
import { absFixed, fixedToNumber, formatFixedPlaces, formatUsd, mulFixed, type Fixed } from "@/lib/fixed";
import { placeOrder } from "@/lib/store/actions";

import { useConsole, useSession } from "./ConsoleProvider";
import { keepFocus } from "./keep-focus";

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
                    <td className={`px-4 py-4 ${p.qty > 0n ? "text-glow" : "text-ember"}`}>{p.qty > 0n ? "Long" : "Short"}</td>
                    <td className="px-4 py-4">{formatFixedPlaces(absFixed(p.qty), 6)}</td>
                    <td className="px-4 py-4">{formatPrice(fixedToNumber(p.entry), places)}</td>
                    <td className="px-4 py-4">{formatPrice(fixedToNumber(mark), places)}</td>
                    <td className={`px-4 py-4 ${pnl < 0n ? "text-ember" : "text-glow"}`}>{formatUsd(pnl)}</td>
                    <td className="px-4 py-4 text-right">
                      <button type="button" disabled={busy || !market?.open} className={BUTTON} aria-label={`Close ${market?.symbol ?? ""} position`}
                        onClick={(event) => { keepFocus(event.currentTarget); void placeOrder(store, { market: p.market, side: p.qty > 0n ? "sell" : "buy", notional: absFixed(mulFixed(p.qty, mark)), slippageBps: 25, kind: { type: "market" }, reduceOnly: true, qty: absFixed(p.qty) }); }}>
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
