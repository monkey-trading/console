"use client";

/** The middle pane: the selected market's price, its chart, and the Reference / Execution / Risk strip. */

import { formatPrice, splitDecimals } from "@/lib/price-format";
import { TIMEFRAMES } from "@/lib/bars";
import { formatMovePercent } from "@/lib/format";
import { liquidationPrice } from "@/lib/liquidation";
import { fixedToNumber, moveBps } from "@/lib/fixed";
import { quoteFor, STRESS_SPREAD_BPS } from "@/lib/pricing";
import type { ChartMode, ConsoleState } from "@/lib/store/state";
import type { MarketModel } from "@/lib/models";

import { useConsole, useSession } from "./ConsoleProvider";
import { MarketStatus, STRESS_NAMES, STRESS_TONE } from "./MarketStatus";
import { PriceChart, type PriceMarker } from "./PriceChart";

const MODES: readonly { mode: ChartMode; label: string; detail: string }[] = [
  { mode: "reference", label: "Reference", detail: "Multi-venue median" },
  { mode: "execution", label: "Execution", detail: "House counterparty" },
  { mode: "risk", label: "Risk mode", detail: "" },
];

/** The lines drawn across the chart: the open position's entry and close-out price, resting orders, and the quote in Execution. */
function markersFor(state: ConsoleState, market: MarketModel, levels: { ask: number; bid: number } | null): PriceMarker[] {
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
  if (state.mode === "execution" && levels) {
    out.push({ price: levels.ask, tone: "glow", style: "solid", title: "Buy" }, { price: levels.bid, tone: "ember", style: "solid", title: "Sell" });
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
  const levels = market.mark === null ? null : {
    ask: fixedToNumber(quoteFor({ index: market.mark, side: "buy", baseSpreadBps: market.baseSpreadBps, spreadTiers: market.view.spread_tiers, stress: market.stress, heldNotional: 0n, orderNotional: 0n, grows: false }).price),
    bid: fixedToNumber(quoteFor({ index: market.mark, side: "sell", baseSpreadBps: market.baseSpreadBps, spreadTiers: market.view.spread_tiers, stress: market.stress, heldNotional: 0n, orderNotional: 0n, grows: false }).price),
  };
  const markers = markersFor(state, market, levels);
  return (
    <div className="min-w-0 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <div>
          <h2 className="text-sm font-medium">{market.symbol.replace("-", " / ")} <span className="ml-2 text-caption font-normal text-fg-3">{market.name}</span></h2>
          <p className="mt-2 text-2xl tracking-tight">
            <span aria-hidden="true">{whole}<span className="text-fg-3">{decimals}</span></span>{" "}
            <span aria-hidden="true" className={`text-caption ${change < 0 ? "text-ember" : "text-glow"}`}>{formatMovePercent(change)}</span>
            <span className="sr-only">{market.symbol} index price {mark === null ? "unavailable" : formatPrice(mark, market.places)}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div role="group" aria-label="Timeframe" className="flex gap-1">
            {TIMEFRAMES.map((tf) => (
              <button key={tf.id} type="button" aria-pressed={state.timeframe === tf.id} onClick={() => store.setTimeframe(tf.id)}
                className={`rounded border px-2 py-1 text-label focus-visible:outline-2 focus-visible:outline-glow ${state.timeframe === tf.id ? "border-glow bg-glow/10 text-glow" : "border-line-2 text-fg-2 hover:text-fg"}`}>
                {tf.id}
              </button>
            ))}
          </div>
          <MarketStatus market={market} />
        </div>
      </div>
      <PriceChart symbol={market.symbol} places={market.places} bars={bars} seriesKey={`${market.id}-${state.timeframe}`} markers={markers} />
      {state.mode === "risk" && <p className="border-t border-line px-4 py-2 text-label text-fg-3">Stress level {market.stress} ({STRESS_NAMES[market.stress]}): spreads widen by up to {STRESS_SPREAD_BPS[market.stress]} bps. The dashed red line is where your position would be closed out, estimated from today's margin.</p>}
      <div role="group" aria-label="Chart mode" className="grid grid-cols-3 divide-x divide-line border-t border-line px-2 py-1 text-center">
        {MODES.map(({ mode, label, detail }) => (
          <button
            key={mode}
            type="button"
            aria-pressed={state.mode === mode}
            onClick={() => store.setMode(mode)}
            className={`border-b-2 py-4 focus-visible:outline-2 focus-visible:outline-glow ${state.mode === mode ? "border-glow" : "border-transparent hover:bg-glow/5"}`}
          >
            <span className="block text-label text-fg-3">{label}</span>
            <span className={`mt-2 block text-caption ${mode === "risk" ? STRESS_TONE[market.stress] : "text-fg-2"}`}>
              {mode === "risk" ? STRESS_NAMES[market.stress] : detail}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
