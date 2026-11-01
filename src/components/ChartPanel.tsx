"use client";

/** The middle pane: the selected market's price, the timeframe switch, and the chart. */

import { TIMEFRAMES } from "@/lib/bars";
import { fixedToNumber, moveBps } from "@/lib/fixed";
import { formatMovePercent } from "@/lib/format";
import { closeOutMarker } from "@/lib/liquidation";
import type { MarketModel } from "@/lib/models";
import { formatMark, splitDecimals } from "@/lib/price-format";
import type { ConsoleState } from "@/lib/store/state";

import { useConsole, useSession } from "./ConsoleProvider";
import { PriceChart, type PriceMarker } from "./PriceChart";

/**
 * The lines drawn across the chart: the open position's entry and close-out price, and resting orders.
 * An order's line follows its side (buy green, sell red) and the entry is neutral on either side, so
 * the colour of a line says which way it trades, never which way the position points.
 */
export function markersFor(state: ConsoleState, market: MarketModel): PriceMarker[] {
  const out: PriceMarker[] = [];
  const position = state.account?.positions.find((p) => p.market === market.id);
  if (state.account && position) {
    out.push({ price: fixedToNumber(position.entry), tone: "fg-2", style: "dotted", title: `${position.qty > 0n ? "Long" : "Short"} entry` });
    const liq = closeOutMarker(state.signatures, state.account, market, state.markets);
    if (liq !== null) out.push({ price: fixedToNumber(liq), tone: "ember", style: "dashed", title: "Close-out (est.)" });
  }
  for (const order of state.account?.orders ?? []) {
    if (order.market === market.id && order.kind.kind !== "market") out.push({ price: Number(order.kind.price), tone: order.side === "buy" ? "glow" : "ember", style: "dotted", title: `${order.kind.kind} ${order.side}` });
  }
  return out;
}

export function ChartPanel() {
  const state = useConsole();
  const { store } = useSession();
  const market = state.markets.find((m) => m.id === state.selected);
  if (!market) return null;
  const bars = state.bars[market.id]?.[state.timeframe] ?? [];
  const change = market.mark !== null && market.reference !== null ? moveBps(market.reference, market.mark) : 0;
  const shown = market.mark === null ? "—" : formatMark(market.mark, market.places);
  const [whole, decimals] = splitDecimals(shown);
  return (
    <div className="flex min-w-0 flex-1 flex-col lg:min-h-[26rem]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-6 lg:py-4">
        <div>
          <h2 id="market-title" tabIndex={-1} className="text-sm font-medium outline-none">{market.symbol.replace("-", " / ")} <span className="ml-2 text-caption font-normal text-fg-3">{market.name}</span> <span className={`ml-2 text-label font-normal ${market.open ? "text-glow" : "text-ember"} lg:hidden`}>{market.open ? "Open" : "Closed"}</span></h2>
          <p className="mt-1 text-2xl tracking-tight lg:mt-2">
            <span aria-hidden="true">{whole}<span className="text-fg-3">{decimals}</span></span>{" "}
            <span aria-hidden="true" className={`text-caption ${change < 0 ? "text-ember" : "text-glow"}`}>{formatMovePercent(change)}</span>
            <span className="sr-only">{market.symbol} index price {shown === "—" ? "unavailable" : shown}</span>
          </p>
        </div>
        <div role="group" aria-label="Timeframe" className="grid w-full grid-cols-5 gap-1 sm:w-auto lg:flex">
          {TIMEFRAMES.map((tf) => (
            <button key={tf.id} type="button" aria-pressed={state.timeframe === tf.id} onClick={() => store.setTimeframe(tf.id)}
              className={`min-h-11 rounded border px-2 py-1 text-label sm:min-w-14 lg:min-h-0 lg:min-w-0 focus-visible:outline-2 focus-visible:outline-glow ${state.timeframe === tf.id ? "border-glow bg-glow/10 text-glow" : "border-line-2 text-fg-2 hover:text-fg"}`}>
              {tf.id}
            </button>
          ))}
        </div>
      </div>
      <PriceChart symbol={market.symbol} places={market.places} bars={bars} seriesKey={`${market.id}-${state.timeframe}`} markers={markersFor(state, market)} />
    </div>
  );
}
