"use client";

/**
 * The candlestick chart, drawn by TradingView Lightweight Charts, which is loaded in the browser
 * only. It takes its colours from the theme tokens, fills its pane, and carries the library's
 * attribution as its licence asks.
 */

import type { IChartApi, IPriceLine, ISeriesApi, LineStyle as LineStyleEnum } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Bar } from "@/lib/bars";
import { formatPrice } from "@/lib/price-format";

/** The theme token that colours a marker. */
export type MarkerTone = "glow" | "ember" | "amber";

/** A horizontal line across the chart, such as a position's entry. */
export interface PriceMarker {
  price: number;
  tone: MarkerTone;
  title: string;
  style: "solid" | "dashed" | "dotted";
}

interface Props {
  symbol: string;
  places: number;
  bars: readonly Bar[];
  /** Changes when the market or timeframe does, so the chart reloads its data instead of appending. */
  seriesKey: string;
  markers: readonly PriceMarker[];
  /** TEMPORARY design aid: the outline of down candles, which are hollow either way. */
  downTone: "fg-2" | "ember";
  /** TEMPORARY design aid: the live ember candidate, so tokens are read again when it changes. */
  emberKey: string;
}

interface Live {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  lineStyle: typeof LineStyleEnum;
  lines: IPriceLine[];
  key: string;
  count: number;
}

const VISIBLE_BARS = 100;

/** A theme token's value, read from the document. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
}

const toData = (bar: Bar) => ({ ...bar, time: bar.time as import("lightweight-charts").UTCTimestamp });

export function PriceChart({ symbol, places, bars, seriesKey, markers, downTone, emberKey }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const [ready, setReady] = useState(0);
  const [hovered, setHovered] = useState<Bar | null>(null);
  const markerKey = JSON.stringify(markers);
  const stable = useMemo(() => JSON.parse(markerKey) as PriceMarker[], [markerKey]);

  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};
    void import("lightweight-charts").then(({ createChart, CandlestickSeries, CrosshairMode, LineStyle }) => {
      const el = host.current;
      if (cancelled || !el) return;
      const chart = createChart(el, {
        autoSize: true,
        layout: { background: { color: token("ink-1") }, textColor: token("fg-3"), fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: token("line") }, horzLines: { color: token("line") } },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: token("edge"), labelBackgroundColor: token("line-2") },
          horzLine: { color: token("edge"), labelBackgroundColor: token("line-2") },
        },
        rightPriceScale: { borderColor: token("line-2") },
        timeScale: { borderColor: token("line-2"), timeVisible: true, secondsVisible: false },
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: token("glow"), borderUpColor: token("glow"), wickUpColor: token("glow"),
        downColor: "transparent",
      });
      chart.subscribeCrosshairMove((param) => {
        const point = param.seriesData.get(series);
        setHovered(point && "open" in point ? { time: Number(point.time), open: point.open, high: point.high, low: point.low, close: point.close } : null);
      });
      live.current = { chart, series, lineStyle: LineStyle, lines: [], key: "", count: 0 };
      dispose = () => chart.remove();
      setReady((n) => n + 1);
    });
    return () => {
      cancelled = true;
      dispose();
      live.current = null;
    };
  }, []);

  useEffect(() => {
    // Down candles are hollow: no fill, and the outline and wick take the chosen tone.
    live.current?.series.applyOptions({ downColor: "transparent", borderDownColor: token(downTone), wickDownColor: token(downTone) });
  }, [ready, downTone, emberKey]);

  useEffect(() => {
    const c = live.current;
    const last = bars[bars.length - 1];
    if (!c || !last) return;
    c.series.applyOptions({ priceFormat: { type: "price", precision: places, minMove: 1 / 10 ** places } });
    if (c.key !== seriesKey || bars.length < c.count || bars.length - c.count > 1) {
      c.series.setData(bars.map(toData));
      c.chart.timeScale().setVisibleLogicalRange({ from: bars.length - VISIBLE_BARS, to: bars.length + 4 });
    } else {
      c.series.update(toData(last));
    }
    c.key = seriesKey;
    c.count = bars.length;
  }, [ready, bars, seriesKey, places]);

  useEffect(() => {
    const c = live.current;
    if (!c) return;
    for (const line of c.lines) c.series.removePriceLine(line);
    const styles = { solid: c.lineStyle.Solid, dashed: c.lineStyle.Dashed, dotted: c.lineStyle.Dotted };
    c.lines = stable.map((m) => c.series.createPriceLine({ price: m.price, color: token(m.tone), lineWidth: 1, lineStyle: styles[m.style], axisLabelVisible: true, title: m.title }));
  }, [ready, stable, emberKey]);

  const shown = hovered ?? bars[bars.length - 1] ?? null;
  return (
    <div className="relative h-[clamp(14rem,40vh,28rem)] w-full">
      <div ref={host} role="img" aria-label={`${symbol} candlestick chart`} className="absolute inset-0" />
      {shown && (
        <p aria-hidden="true" className="pointer-events-none absolute top-2 left-3 z-10 flex flex-wrap gap-x-3 text-label text-fg-2">
          <span>O <span className="text-fg">{formatPrice(shown.open, places)}</span></span>
          <span>H <span className="text-fg">{formatPrice(shown.high, places)}</span></span>
          <span>L <span className="text-fg">{formatPrice(shown.low, places)}</span></span>
          <span>C <span className={shown.close >= shown.open ? "text-glow" : "text-ember"}>{formatPrice(shown.close, places)}</span></span>
        </p>
      )}
    </div>
  );
}
