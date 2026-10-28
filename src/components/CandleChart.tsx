/** Candlesticks of the marks the console has seen, with the overlay for the chosen mode. */

import type { Candle } from "@/lib/candles";
import { formatPrice, PLOT, scaleFor } from "@/lib/chart";
import type { ChartMode } from "@/lib/store/state";

const CANDLE_STEP = (PLOT.right - PLOT.left) / 60;
const STRESS_TINT = ["", "fill-amber/5", "fill-amber/10", "fill-alarm/10"] as const;

export interface ChartLevels {
  /** The price a buy would fill at for a normal-size order. */
  ask: number;
  /** The price a sell would fill at. */
  bid: number;
}

interface Props {
  symbol: string;
  places: number;
  candles: readonly Candle[];
  mode: ChartMode;
  stress: number;
  levels: ChartLevels | null;
}

/** The price chart; its text changes every second, so it is hidden from assistive technology beside a static label. */
export function CandleChart({ symbol, places, candles, mode, stress, levels }: Props) {
  const scale = scaleFor(candles, mode === "execution" && levels ? [levels.ask, levels.bid] : []);
  const last = candles[candles.length - 1];
  const ticks = [0, 1, 2, 3, 4].map((i) => scale.min + ((scale.max - scale.min) * (4 - i)) / 4);
  const x = (i: number) => PLOT.left + 5 + i * CANDLE_STEP;
  const offset = 60 - candles.length;
  return (
    <svg viewBox="0 0 560 195" role="img" aria-label={`${symbol} candlestick chart, ${mode} mode`} className="h-auto max-h-[44vh] w-full px-3 pb-2">
      {mode === "risk" && <rect x={PLOT.left} y={PLOT.top} width={PLOT.right - PLOT.left} height={PLOT.bottom - PLOT.top} className={STRESS_TINT[stress] ?? ""} />}
      {ticks.map((price) => <line key={price} x1={PLOT.left} y1={scale.y(price)} x2={PLOT.right} y2={scale.y(price)} stroke="var(--color-line)" />)}
      {[0, 1, 2, 3, 4, 5].map((i) => <line key={i} x1={40 + i * 100} y1={PLOT.top} x2={40 + i * 100} y2={PLOT.bottom} stroke="var(--color-line)" />)}
      <g aria-hidden="true">
        {candles.map((c, i) => {
          const up = c.close >= c.open;
          const colour = up ? "var(--color-glow)" : "var(--color-fg-2)";
          const top = scale.y(Math.max(c.open, c.close));
          return (
            <g key={c.t}>
              <line x1={x(i + offset)} x2={x(i + offset)} y1={scale.y(c.high)} y2={scale.y(c.low)} stroke={colour} />
              <rect x={x(i + offset) - 3} y={top} width="6" height={Math.max(2, scale.y(Math.min(c.open, c.close)) - top)} fill={up ? colour : "var(--color-ink-1)"} stroke={colour} />
            </g>
          );
        })}
        {last && mode === "reference" && <Level y={scale.y(last.close)} colour="var(--color-glow)" label={formatPrice(last.close, places)} />}
        {mode === "execution" && levels && (
          <>
            <Level y={scale.y(levels.ask)} colour="var(--color-glow)" label={`Buy ${formatPrice(levels.ask, places)}`} />
            <Level y={scale.y(levels.bid)} colour="var(--color-fg-2)" label={`Sell ${formatPrice(levels.bid, places)}`} />
          </>
        )}
        {mode === "risk" && (
          <text x={PLOT.left + 6} y={PLOT.top + 12} fill="var(--color-fg-2)" fontSize="10">Stress level {stress}: spreads widen with it</text>
        )}
        {ticks.map((price) => (
          <text key={price} x={PLOT.right - 2} y={scale.y(price) - 3} textAnchor="end" fill="var(--color-fg-3)" fontSize="9">{formatPrice(price, places)}</text>
        ))}
      </g>
    </svg>
  );
}

function Level({ y, colour, label }: { y: number; colour: string; label: string }) {
  return (
    <>
      <line x1={PLOT.left} y1={y} x2={PLOT.right} y2={y} stroke={colour} strokeDasharray="3 5" opacity="0.7" />
      <text x={PLOT.left + 4} y={y - 4} fill={colour} fontSize="10">{label}</text>
    </>
  );
}
