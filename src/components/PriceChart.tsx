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
import { formatStamp } from "@/lib/time";

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
}

interface Live {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  lineStyle: typeof LineStyleEnum;
  lines: IPriceLine[];
  key: string;
  count: number;
  /** The time of the first bar loaded, so a series that dropped its oldest bar reloads. */
  first: number;
}

const VISIBLE_BARS = 100;
/** Bars listed in the keyboard-reachable table. */
const TABLE_BARS = 30;

/** A theme token's value, read from the document. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
}

// The library brands its time type; our bars hold UTC seconds, which is what it means.
const toData = (bar: Bar) => ({ ...bar, time: bar.time as import("lightweight-charts").UTCTimestamp });

export function PriceChart({ symbol, places, bars, seriesKey, markers }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const [ready, setReady] = useState(0);
  const [hovered, setHovered] = useState<Bar | null>(null);
  const [failed, setFailed] = useState(false);
  const markerKey = JSON.stringify(markers);
  // `markerKey` was made from `PriceMarker[]`, so parsing it gives the same shape back.
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
        // A finger dragging up or down scrolls the page; one dragging sideways pans the chart.
        handleScroll: { vertTouchDrag: false },
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: token("glow"), borderUpColor: token("glow"), wickUpColor: token("glow"),
        downColor: "transparent", borderDownColor: token("ember"), wickDownColor: token("ember"),
      });
      chart.subscribeCrosshairMove((param) => {
        const point = param.seriesData.get(series);
        setHovered(point && "open" in point ? { time: Number(point.time), open: point.open, high: point.high, low: point.low, close: point.close } : null);
      });
      // The attribution link opens another site in a new tab; it gets the same rel as every other such link.
      for (const link of el.querySelectorAll("a")) link.rel = "noopener noreferrer";
      live.current = { chart, series, lineStyle: LineStyle, lines: [], key: "", count: 0, first: 0 };
      dispose = () => chart.remove();
      setReady((n) => n + 1);
    }).catch(() => {
      // The library did not load (a failed chunk) or could not start; say so instead of leaving a blank pane.
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      dispose();
      live.current = null;
    };
  }, []);

  useEffect(() => {
    const c = live.current;
    const last = bars[bars.length - 1];
    if (!c || !last) return;
    c.series.applyOptions({ priceFormat: { type: "price", precision: places, minMove: 1 / 10 ** places } });
    const reload = c.key !== seriesKey || bars.length < c.count || bars.length - c.count > 1;
    if (reload) {
      c.series.setData(bars.map(toData));
      c.chart.timeScale().setVisibleLogicalRange({ from: bars.length - VISIBLE_BARS, to: bars.length + 4 });
    } else if (bars[0]?.time !== c.first) {
      // The oldest retained bar rolled off: reload the data but keep the user's pan and zoom.
      const scale = c.chart.timeScale();
      const logical = scale.getVisibleLogicalRange();
      const view = scale.getVisibleRange();
      c.series.setData(bars.map(toData));
      if (logical && logical.to >= c.count - 1) {
        // The user was at the live edge: keep following it at the same zoom.
        const width = logical.to - logical.from;
        scale.setVisibleLogicalRange({ from: bars.length + 4 - width, to: bars.length + 4 });
      } else if (view) scale.setVisibleRange(view);
    } else {
      c.series.update(toData(last));
    }
    c.key = seriesKey;
    c.count = bars.length;
    c.first = bars[0]?.time ?? 0;
  }, [ready, bars, seriesKey, places]);

  useEffect(() => {
    const c = live.current;
    if (!c) return;
    for (const line of c.lines) c.series.removePriceLine(line);
    const styles = { solid: c.lineStyle.Solid, dashed: c.lineStyle.Dashed, dotted: c.lineStyle.Dotted };
    c.lines = stable.map((m) => c.series.createPriceLine({ price: m.price, color: token(m.tone), lineWidth: 1, lineStyle: styles[m.style], axisLabelVisible: true, title: m.title }));
  }, [ready, stable]);

  const shown = hovered ?? bars[bars.length - 1] ?? null;
  return (
    <div className="relative h-[min(28rem,55svh)] min-h-64 w-full lg:h-auto lg:flex-1">
      <div ref={host} role="group" aria-label={`${symbol} candlestick chart`} className="absolute inset-0" />
      {failed && <p role="alert" className="absolute inset-0 z-10 flex items-center justify-center text-caption text-ember">The chart could not load. Reload the page to try again.</p>}
      <p className="sr-only">
        {symbol} candlestick chart. {shown ? `Latest bar: open ${formatPrice(shown.open, places)}, high ${formatPrice(shown.high, places)}, low ${formatPrice(shown.low, places)}, close ${formatPrice(shown.close, places)}.` : "No bars yet."}
        {markers.map((m) => ` ${m.title} at ${formatPrice(m.price, places)}.`).join("")}
      </p>
      {/* The chart's pointer-only history, as a table the keyboard and screen readers can reach: hidden until it takes focus. */}
      <details className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:top-8 focus-within:left-3 focus-within:z-20 focus-within:max-h-56 focus-within:overflow-auto focus-within:rounded focus-within:border focus-within:border-line-2 focus-within:bg-ink-2 focus-within:p-2 focus-within:text-label">
        <summary className="text-fg-2">Recent bars as a table</summary>
        <table>
          <caption className="sr-only">The latest {Math.min(bars.length, TABLE_BARS)} bars of {symbol}, newest first</caption>
          <thead><tr><th scope="col">Time (UTC)</th><th scope="col">Open</th><th scope="col">High</th><th scope="col">Low</th><th scope="col">Close</th></tr></thead>
          <tbody>
            {bars.slice(-TABLE_BARS).reverse().map((bar) => (
              <tr key={bar.time}><th scope="row">{formatStamp(bar.time * 1000)}</th><td>{formatPrice(bar.open, places)}</td><td>{formatPrice(bar.high, places)}</td><td>{formatPrice(bar.low, places)}</td><td>{formatPrice(bar.close, places)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
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
