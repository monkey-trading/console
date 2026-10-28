"use client";

/** The middle pane: the selected market's price, the timeframe switch, and the chart. */

import { TIMEFRAMES } from "@/lib/bars";
import { fixedToNumber, moveBps } from "@/lib/fixed";
import { formatMovePercent } from "@/lib/format";
import { liquidationPrice } from "@/lib/liquidation";
import type { MarketModel } from "@/lib/models";
import { formatPrice, splitDecimals } from "@/lib/price-format";
import type { ConsoleState } from "@/lib/store/state";

import { useConsole, useSession } from "./ConsoleProvider";
import { PriceChart, type PriceMarker } from "./PriceChart";

/** The lines drawn across the chart: the open position's entry and close-out price, and resting orders. */
function markersFor(state: ConsoleState, market: MarketModel): PriceMarker[] {
  const out: PriceMarker[] = [];
  const position = state.account?.positions.find((p) => p.market === market.id);
  if (state.account && position) {
    out.push({ price: fixedToNumber(position.entry), tone: "glow", style: "dotted", title: `${position.qty > 0n ? "Long" : "Short"} entry` });
    const liq = liquidationPrice(state.account, market, state.markets);
    if (liq !== null) out.push({ price: fixedToNumber(liq), tone: "ember", style: "dashed", title: "Close-out (est.)" });
  }
  for (const order of state.account?.orders ?? []) {
    if (order.market === market.id && order.kind.type !== "market") out.push({ price: Number(order.kind.price), tone: "amber", style: "dotted", title: `${order.kind.type} ${order.side}` });
  }
  return out;
}

export function ChartPanel() {
  const state = useConsole();
  const { store } = useSession();
  const market = state.markets.find((m) => m.id === state.selected);
  if (!market) return null;
  const bars = state.bars[market.id]?.[state.timeframe] ?? [];
  const mark = market.mark === null ? null : fixedToNumber(market.mark);
  const change = market.mark !== null && market.reference !== null ? moveBps(market.reference, market.mark) : 0;
  const [whole, decimals] = splitDecimals(mark === null ? "—" : formatPrice(mark, market.places));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div>
          <h2 className="text-sm font-medium">{market.symbol.replace("-", " / ")} <span className="ml-2 text-caption font-normal text-fg-3">{market.name}</span></h2>
          <p className="mt-2 text-2xl tracking-tight">
            <span aria-hidden="true">{whole}<span className="text-fg-3">{decimals}</span></span>{" "}
            <span aria-hidden="true" className={`text-caption ${change < 0 ? "text-ember" : "text-glow"}`}>{formatMovePercent(change)}</span>
            <span className="sr-only">{market.symbol} index price {mark === null ? "unavailable" : formatPrice(mark, market.places)}</span>
          </p>
        </div>
        <div role="group" aria-label="Timeframe" className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button key={tf.id} type="button" aria-pressed={state.timeframe === tf.id} onClick={() => store.setTimeframe(tf.id)}
              className={`rounded border px-2 py-1 text-label focus-visible:outline-2 focus-visible:outline-glow ${state.timeframe === tf.id ? "border-glow bg-glow/10 text-glow" : "border-line-2 text-fg-2 hover:text-fg"}`}>
              {tf.id}
            </button>
          ))}
        </div>
      </div>
      <PriceChart symbol={market.symbol} places={market.places} bars={bars} seriesKey={`${market.id}-${state.timeframe}`} markers={markersFor(state, market)} />
    </div>
  );
}
