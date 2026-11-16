"use client";

/** The left pane: every listed market with its mark, move, and whether it is open and priced. */

import type { AssetClass } from "@/lib/engine/types";
import { formatMark } from "@/lib/price-format";
import { formatMovePercent } from "@/lib/format";
import { moveBps } from "@/lib/fixed";
import { marketStatus, STATUS_LABELS } from "@/lib/unpriced";

import { useConsole, useSession } from "./ConsoleProvider";

/** Each asset class as the list's note names its markets, in the order it names them. */
const CLASS_WORDS: [AssetClass, string][] = [["crypto", "crypto"], ["fx", "FX"], ["index", "index"], ["commodity", "commodity"], ["equity", "share"]];

/** The dot beside each market status; Tailwind needs each class name whole. */
const DOT = { open: "bg-glow", closed: "bg-ember", unpriced: "bg-amber" } as const;

/** The note under the list, naming the kinds of market it holds, or null for an empty list. */
export function describeListing(classes: readonly AssetClass[]): string | null {
  const words = CLASS_WORDS.filter(([kind]) => classes.includes(kind)).map(([, word]) => word);
  const last = words.pop();
  if (last === undefined) return null;
  return `This list covers ${words.length === 0 ? last : `${words.join(", ")} and ${last}`} markets.`;
}

/** `onPick` runs after a market is chosen, so the phone can move on to its chart. */
export function Watchlist({ onPick }: { onPick?: () => void }) {
  const { markets, selected } = useConsole();
  const { store } = useSession();
  const listing = describeListing(markets.map((m) => m.view.asset_class));
  return (
    <div className="lg:h-full lg:border-r lg:border-line">
      <h2 className="border-b border-line px-4 py-3 text-label tracking-caps text-fg-3 uppercase">Global watchlist</h2>
      <ul>
        {markets.map((m) => {
          const change = m.mark !== null && m.reference !== null ? moveBps(m.reference, m.mark) : 0;
          const active = m.id === selected;
          const status = marketStatus(m);
          return (
            <li key={m.id} className="border-b border-line">
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${m.symbol}, ${STATUS_LABELS[status].toLowerCase()}`}
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
                  <span className={`size-1.5 rounded-full ${DOT[status]}`} />
                  {STATUS_LABELS[status]}{m.stress > 0 ? ` · stress ${m.stress}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {listing !== null && <p className="hidden px-4 py-5 text-label leading-relaxed text-fg-3 lg:block">{listing}</p>}
    </div>
  );
}
