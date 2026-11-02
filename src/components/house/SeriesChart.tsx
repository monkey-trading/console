"use client";

/**
 * A line or area chart over series points, drawn by Lightweight Charts (loaded in the browser
 * only, like the price chart). The chart is created once; a new set of points goes in through the
 * series' own `setData` from an effect, so a re-render of the panel never rebuilds it. An optional
 * floor shades everything below it.
 */

import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { memo, useEffect, useRef, useState } from "react";

import type { SeriesPoint } from "@/lib/house-series";

import { chartOptions, hardenLinks, token, withOpacity, type Tone } from "./chart-theme";

/** One plotted line: its points, the theme token that colours it, and whether it fills toward the axis. */
export interface ChartLine {
  id: string;
  tone: Tone;
  points: readonly SeriesPoint[];
  area?: boolean;
}

interface Props {
  lines: readonly ChartLine[];
  /** Shades the plane below this value, when set. */
  floor?: number | null;
  /** Changes when the market or timeframe does, so the chart refits its view instead of keeping the old one. */
  viewKey: string;
  format: (value: number) => string;
  /** What the chart shows, for the group's accessible name. */
  label: string;
}

interface Live {
  chart: IChartApi;
  series: Map<string, ISeriesApi<"Area">>;
  floor: ISeriesApi<"Area">;
  area: AreaSeriesType;
  viewKey: string;
}

type AreaSeriesType = (typeof import("lightweight-charts"))["AreaSeries"];

// The library brands its time type; our points hold Unix milliseconds, which are seconds here.
const timeOf = (ts: number) => Math.floor(ts / 1000) as UTCTimestamp;

function SeriesChartView({ lines, floor = null, viewKey, format, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const [ready, setReady] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};
    void import("lightweight-charts").then(({ createChart, AreaSeries, LineStyle }) => {
      const el = host.current;
      if (cancelled || !el) return;
      const chart = createChart(el, chartOptions());
      hardenLinks(el);
      const floorSeries = chart.addSeries(AreaSeries, {
        lineColor: withOpacity(token("ember"), 0.7), lineStyle: LineStyle.Dashed, lineWidth: 1,
        topColor: withOpacity(token("ember"), 0.16), bottomColor: withOpacity(token("ember"), 0.02),
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      live.current = { chart, series: new Map(), floor: floorSeries, area: AreaSeries, viewKey: "" };
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
  }, []);

  useEffect(() => {
    const c = live.current;
    if (!c) return;
    c.chart.applyOptions({ localization: { priceFormatter: format } });
  }, [ready, format]);

  useEffect(() => {
    const c = live.current;
    if (!c) return;
    const wanted = new Set(lines.map((line) => line.id));
    for (const [id, series] of c.series) {
      if (!wanted.has(id)) {
        c.chart.removeSeries(series);
        c.series.delete(id);
      }
    }
    for (const line of lines) {
      let series = c.series.get(line.id);
      if (series === undefined) {
        const colour = token(line.tone);
        series = c.chart.addSeries(c.area, {
          lineColor: colour, lineWidth: 2, topColor: line.area === true ? withOpacity(colour, 0.22) : "transparent", bottomColor: line.area === true ? withOpacity(colour, 0.02) : "transparent",
          priceLineVisible: false, crosshairMarkerRadius: 3,
        });
        c.series.set(line.id, series);
      }
      series.setData(line.points.map((p) => ({ time: timeOf(p.ts), value: p.value })));
    }
    const first = lines.flatMap((line) => line.points.slice(0, 1))[0];
    const last = lines.flatMap((line) => line.points.slice(-1))[0];
    c.floor.setData(floor !== null && first !== undefined && last !== undefined && last.ts > first.ts ? [{ time: timeOf(first.ts), value: floor }, { time: timeOf(last.ts), value: floor }] : []);
    // A view is fitted once it has data: a fit of an empty series is dropped by the library, and a later `setData` does not repeat it.
    if (c.viewKey !== viewKey && first !== undefined) {
      c.chart.timeScale().fitContent();
      c.viewKey = viewKey;
    }
  }, [ready, lines, floor, viewKey]);

  return (
    <div className="relative min-h-52 flex-1">
      <div ref={host} role="group" aria-label={label} className="absolute inset-0 max-lg:[&_a]:after:absolute max-lg:[&_a]:after:-inset-3.5 max-lg:[&_a]:after:content-['']" />
      {failed && <p role="alert" className="absolute inset-0 z-10 flex items-center justify-center text-caption text-ember">The chart could not load. Reload the page to try again.</p>}
    </div>
  );
}

/** Memoised on its props: the panel re-renders only when a feed delivers new points. */
export const SeriesChart = memo(SeriesChartView);
