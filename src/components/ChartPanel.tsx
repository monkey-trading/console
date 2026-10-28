"use client";

/** The middle pane: the selected market's price, its chart, and the Reference / Execution / Risk strip. */

import { formatPrice, splitDecimals } from "@/lib/chart";
import { formatMovePercent } from "@/lib/format";
import { fixedToNumber, moveBps } from "@/lib/fixed";
import { quoteFor } from "@/lib/pricing";
import type { ChartMode } from "@/lib/store/state";

import { CandleChart } from "./CandleChart";
import { useConsole, useSession } from "./ConsoleProvider";
import { MarketStatus, STRESS_NAMES, STRESS_TONE } from "./MarketStatus";

const MODES: readonly { mode: ChartMode; label: string; detail: string }[] = [
  { mode: "reference", label: "Reference", detail: "Multi-venue median" },
  { mode: "execution", label: "Execution", detail: "House counterparty" },
  { mode: "risk", label: "Risk mode", detail: "" },
];

export function ChartPanel() {
  const state = useConsole();
  const { store } = useSession();
  const market = state.markets.find((m) => m.id === state.selected);
  if (!market) return null;
  const candles = state.candles[market.id] ?? [];
  const mark = market.mark === null ? null : fixedToNumber(market.mark);
  const change = market.mark !== null && market.reference !== null ? moveBps(market.reference, market.mark) : 0;
  const [whole, decimals] = splitDecimals(mark === null ? "—" : formatPrice(mark, market.places));
  const levels = market.mark === null ? null : {
    ask: fixedToNumber(quoteFor({ index: market.mark, side: "buy", baseSpreadBps: market.baseSpreadBps, spreadTiers: market.view.spread_tiers, stress: market.stress, heldNotional: 0n, orderNotional: 0n, grows: false }).price),
    bid: fixedToNumber(quoteFor({ index: market.mark, side: "sell", baseSpreadBps: market.baseSpreadBps, spreadTiers: market.view.spread_tiers, stress: market.stress, heldNotional: 0n, orderNotional: 0n, grows: false }).price),
  };
  return (
    <div className="min-w-0 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <div>
          <h2 className="text-sm font-medium">{market.symbol.replace("-", " / ")} <span className="ml-2 text-caption font-normal text-fg-3">{market.name}</span></h2>
          <p className="mt-2 text-2xl tracking-tight">
            <span aria-hidden="true">{whole}<span className="text-fg-3">{decimals}</span></span>{" "}
            <span aria-hidden="true" className={`text-caption ${change < 0 ? "text-alarm" : "text-glow"}`}>{formatMovePercent(change)}</span>
            <span className="sr-only">{market.symbol} index price {mark === null ? "unavailable" : formatPrice(mark, market.places)}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded border border-line-2 px-2 py-1 text-label text-fg-2">5s · {MODES.find((m) => m.mode === state.mode)?.label}</span>
          <MarketStatus market={market} />
        </div>
      </div>
      <CandleChart symbol={market.symbol} places={market.places} candles={candles} mode={state.mode} stress={market.stress} levels={levels} />
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
