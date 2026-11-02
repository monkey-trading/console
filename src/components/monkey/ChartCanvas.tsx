"use client";

/**
 * A MONKEY chart drawn by TradingView Lightweight Charts, loaded in the browser only. It takes its
 * colours from the theme tokens and carries the library's attribution as its licence asks. The
 * chart is built once; new data goes straight to its series through refs, so a refresh redraws the
 * canvas and re-renders nothing around it.
 */

import { useEffect, useRef, useState } from "react";

import type { ChartData, ChartPoint } from "@/lib/monkey/feed";

/** The canvas's height, which a chart's loading and failed states reserve too so nothing moves when data arrives. */
export const CHART_HEIGHT = "h-56 sm:h-64";

export type ChartKind = "bars" | "steps" | "lines" | "area";
export type Tone = "glow" | "amber" | "ember";

/** A plotted metric: the key into the feed's lines, the name the legend and the screen reader use, and its colour token. */
export interface LineSpec {
  metric: string;
  label: string;
  tone: Tone;
}

interface Props {
  kind: ChartKind;
  /** Held constant by the caller: a new array rebuilds the chart. */
  lines: readonly LineSpec[];
  data: ChartData | null;
  /** Changes with the timeframe, so the view refits instead of keeping the last window's pan. */
  seriesKey: string;
  format: (value: number) => string;
  /** Times to mark with a halving arrow on the first line. */
  marks: readonly number[];
  label: string;
}

interface Plot {
  setData(points: readonly ChartPoint[]): void;
}

interface Live {
  chart: import("lightweight-charts").IChartApi;
  plots: Record<string, Plot>;
  setMarkers(times: readonly number[], first: readonly ChartPoint[]): void;
  key: string;
}

/** A theme token's value, read from the document. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
}

export function ChartCanvas({ kind, lines, data, seriesKey, format, marks, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const [ready, setReady] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};
    void import("lightweight-charts").then(({ createChart, createSeriesMarkers, LineSeries, HistogramSeries, AreaSeries, LineType, CrosshairMode }) => {
      const el = host.current;
      if (cancelled || !el) return;
      const chart = createChart(el, {
        autoSize: true,
        layout: { background: { color: token("ink-1") }, textColor: token("fg-3"), fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: token("line") }, horzLines: { color: token("line") } },
        crosshair: { mode: CrosshairMode.Normal, vertLine: { color: token("edge"), labelBackgroundColor: token("line-2") }, horzLine: { color: token("edge"), labelBackgroundColor: token("line-2") } },
        rightPriceScale: { borderColor: token("line-2") },
        timeScale: { borderColor: token("line-2"), timeVisible: true, secondsVisible: false },
        // A finger dragging up or down scrolls the page; one dragging sideways pans the chart.
        handleScroll: { vertTouchDrag: false },
        handleScale: { mouseWheel: false },
      });
      const priceFormat = { type: "custom" as const, formatter: format, minMove: 0.01 };
      const plots: Record<string, Plot> = {};
      let setMarkers: Live["setMarkers"] = () => {};
      lines.forEach((spec, index) => {
        const color = token(spec.tone);
        // The library brands its time type; our points hold UTC seconds, which is what it means.
        const toData = (points: readonly ChartPoint[]) => points.map((point) => ({ time: Math.floor(point.ms / 1000) as import("lightweight-charts").UTCTimestamp, value: point.value }));
        if (kind === "bars") {
          const series = chart.addSeries(HistogramSeries, { color, priceFormat, lastValueVisible: false, priceLineVisible: false });
          plots[spec.metric] = { setData: (points) => series.setData(toData(points)) };
        } else if (kind === "area") {
          const series = chart.addSeries(AreaSeries, { lineColor: color, topColor: `${color}55`, bottomColor: `${color}05`, lineWidth: 2, priceFormat });
          plots[spec.metric] = { setData: (points) => series.setData(toData(points)) };
        } else {
          const series = chart.addSeries(LineSeries, { color, lineWidth: 2, priceFormat, ...(kind === "steps" ? { lineType: LineType.WithSteps } : {}) });
          plots[spec.metric] = { setData: (points) => series.setData(toData(points)) };
          if (index === 0) {
            const markers = createSeriesMarkers(series, []);
            setMarkers = (times, first) => markers.setMarkers(times.flatMap((time) => {
              // A halving shows on the first point at or after it, and not at all before the window.
              const at = first.find((point) => point.ms >= time);
              return at === undefined || time < (first[0]?.ms ?? 0) ? [] : [{ time: Math.floor(at.ms / 1000) as import("lightweight-charts").UTCTimestamp, position: "aboveBar" as const, shape: "arrowDown" as const, color: token("amber"), text: "Halving" }];
            }));
          }
        }
      });
      // The attribution link opens another site in a new tab; it gets the same rel as every other such link.
      for (const link of el.querySelectorAll("a")) link.rel = "noopener noreferrer";
      live.current = { chart, plots, setMarkers, key: "" };
      dispose = () => chart.remove();
      setReady((n) => n + 1);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      dispose();
      live.current = null;
    };
    // The chart is rebuilt only for another kind, set of lines or formatter, which the page holds constant; data arrives through the next effect.
  }, [kind, lines, format]);

  useEffect(() => {
    const c = live.current;
    if (!c || data === null) return;
    for (const spec of lines) c.plots[spec.metric]?.setData(data.lines[spec.metric] ?? []);
    const first = lines[0] === undefined ? [] : (data.lines[lines[0].metric] ?? []);
    c.setMarkers(marks, first);
    if (c.key !== seriesKey) {
      c.chart.timeScale().fitContent();
      c.key = seriesKey;
    }
  }, [ready, data, seriesKey, marks, lines]);

  return (
    <div className={`relative w-full ${CHART_HEIGHT}`}>
      <div ref={host} role="group" aria-label={label} className="absolute inset-0 max-lg:[&_a]:after:absolute max-lg:[&_a]:after:-inset-3.5 max-lg:[&_a]:after:content-['']" />
      {failed && <p role="alert" className="absolute inset-0 z-10 flex items-center justify-center text-caption text-ember">The chart could not load. Reload the page to try again.</p>}
    </div>
  );
}
