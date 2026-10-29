"use client";

/** The left pane: every listed market with its mark, move, and whether it is open. */

import { formatMark } from "@/lib/price-format";
import { formatMovePercent } from "@/lib/format";
import { moveBps } from "@/lib/fixed";

import { useConsole, useSession } from "./ConsoleProvider";

/** `onPick` runs after a market is chosen, so the phone can move on to its chart. */
export function Watchlist({ onPick }: { onPick?: () => void }) {
  const { markets, selected } = useConsole();
  const { store } = useSession();
  return (
    <div className="lg:h-full lg:border-r lg:border-line">
      <h2 className="border-b border-line px-4 py-3 text-label tracking-caps text-fg-3 uppercase">Global watchlist</h2>
      <ul>
        {markets.map((m) => {
          const change = m.mark !== null && m.reference !== null ? moveBps(m.reference, m.mark) : 0;
          const active = m.id === selected;
          return (
            <li key={m.id} className="border-b border-line">
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${m.symbol}, ${m.open ? "open" : "closed"}`}
                onClick={() => { store.select(m.id); onPick?.(); }}
                className={`block w-full px-4 py-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow ${active ? "border-l-2 border-l-glow bg-glow/5" : "border-l-2 border-l-transparent hover:bg-glow/5"}`}
              >
                <span aria-hidden="true" className="flex flex-wrap justify-between gap-1 text-caption">
                  <span className="text-fg">{m.symbol.replace("-", " / ")}</span>
                  <span className={change < 0 ? "text-ember" : "text-glow"}>{formatMovePercent(change)}</span>
                </span>
                <span aria-hidden="true" className="mt-2 flex flex-wrap justify-between gap-1 text-caption text-fg-3">
                  <span>{m.name}</span>
                  <span className="text-fg-2">{m.mark === null ? "—" : formatMark(m.mark, m.places)}</span>
                </span>
                <span aria-hidden="true" className="mt-2 flex items-center gap-1.5 text-label text-fg-3">
                  <span className={`size-1.5 rounded-full ${m.open ? "bg-glow" : "bg-ember"}`} />
                  {m.open ? "Open" : "Closed"}{m.stress > 0 ? ` · stress ${m.stress}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="hidden px-4 py-5 text-label leading-relaxed text-fg-3 lg:block">Crypto, FX, an index<br />and gold.</p>
    </div>
  );
}
