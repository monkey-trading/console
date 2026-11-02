"use client";

/**
 * The close-out map: a market's recent index candles with, behind them, a band for each price range
 * at which clients' accounts close out, shaded by the notional there. The bands are the node's last
 * scan, one snapshot: they carry no history along the time axis. Candles come from the marks route.
 * The chart's host stays mounted whatever the feeds say, so the chart is created once and a message
 * is laid over it, never in place of it.
 */

import type { IChartApi, IPriceLine, ISeriesApi, LineStyle, UTCTimestamp } from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TimeframeId } from "@/lib/bars";
import { formatCompactUsd } from "@/lib/chart-format";
import type { MarketId } from "@/lib/engine/types";
import { bandsWithin, bandUsd, closeoutBands, type Band } from "@/lib/house-bands";
import { fixedFromWire, fixedToNumber } from "@/lib/fixed";
import { formatPrice } from "@/lib/price-format";
import { feedProblem } from "@/lib/store/house-feed-text";
import { candlesFeed, positionsFeed } from "@/lib/store/house-feeds";
import { formatClock, formatStamp } from "@/lib/time";

import { useSession } from "../ConsoleProvider";
import { chartOptions, hardenLinks, token, withOpacity } from "./chart-theme";
import { BandsPrimitive } from "./closeout-primitive";
import { Pick } from "./Controls";
import { DataTable } from "./DataTable";
import { Panel, Quiet } from "./Panel";
import { useFeed, useSelected } from "./use-feed";
import { useMarketOptions } from "./use-markets";

const TIMEFRAME_OPTIONS = [{ value: "15m", label: "15m" }, { value: "1h", label: "1h" }, { value: "1D", label: "1D" }] as const satisfies readonly { value: TimeframeId; label: string }[];
const RANGE_OPTIONS = [{ value: 100, label: "±1%" }, { value: 200, label: "±2%" }, { value: 500, label: "±5%" }, { value: 1000, label: "±10%" }] as const;
/** The bands the keyboard-reachable table lists. */
const TABLE_BANDS = 40;

interface Live {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  /** An invisible line that always holds one point, so prices place on the scale with or without candles. */
  anchor: ISeriesApi<"Line">;
  bands: BandsPrimitive;
  line: IPriceLine | null;
  viewKey: string;
  dashed: LineStyle;
  /** The price window the scale fits: the mark and the chosen range around it. */
  bounds: { min: number; max: number } | null;
}

/** The decimals to show before the market's own are known: more for a price near one than for one in the thousands. */
const placesOf = (price: number): number => (price >= 1_000 ? 2 : price >= 10 ? 3 : 5);

/** The close-out map panel: a market's candles with bands of close-out notional behind them. */
export function CloseoutMap({ className }: { className?: string }) {
  const { store } = useSession();
  const markets = useMarketOptions();
  const [picked, setPicked] = useState<MarketId | null>(null);
  const [timeframe, setTimeframe] = useState<TimeframeId>("15m");
  const [rangeBps, setRangeBps] = useState<number>(500);
  const market = picked !== null && markets.some((m) => m.id === picked) ? picked : (markets[0]?.id ?? null);
  const positions = useFeed(useMemo(() => (market === null ? null : positionsFeed(store, market)), [store, market]));
  const candles = useFeed(useMemo(() => (market === null ? null : candlesFeed(store, market, timeframe)), [store, market, timeframe]));
  const host = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const liveBands = useRef<readonly Band[]>([]);
  const [ready, setReady] = useState(0);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<Band | null>(null);
  const view = positions.data;
  const markText = view?.mark ?? null;
  const mark = markText === null ? null : fixedToNumber(fixedFromWire(markText));
  const effectiveBps = view === null ? rangeBps : Math.min(rangeBps, view.closeout_range_bps);
  const bands = useMemo(() => (view === null || mark === null ? [] : bandsWithin(closeoutBands(view), mark, effectiveBps)), [view, mark, effectiveBps]);
  const maxUsd = useMemo(() => Math.max(0, ...bands.map(bandUsd)), [bands]);
  const candleBars = candles.data?.bars;
  const places = useSelected(useCallback((state) => state.markets.find((m) => m.id === market)?.places ?? placesOf(mark ?? 1), [market, mark]));
  const anchorTime = view === null ? null : Math.floor(view.snapshot_ms / 1000);

  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};
    void import("lightweight-charts").then(({ createChart, CandlestickSeries, LineSeries, LineStyle }) => {
      const el = host.current;
      if (cancelled || !el) return;
      const chart = createChart(el, { ...chartOptions(), grid: { vertLines: { color: token("line") }, horzLines: { visible: false } } });
      hardenLinks(el);
      // The price window is the mark and the chosen range around it, whatever the candles reach.
      const autoscaleInfoProvider = (base: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
        const range = live.current?.bounds ?? null;
        return range === null ? base() : { priceRange: { minValue: range.min, maxValue: range.max } };
      };
      const candlesSeries = chart.addSeries(CandlestickSeries, {
        upColor: token("glow"), borderUpColor: token("glow"), wickUpColor: token("glow"),
        downColor: "transparent", borderDownColor: token("ember"), wickDownColor: token("ember"),
        priceLineVisible: false, autoscaleInfoProvider,
      });
      const anchor = chart.addSeries(LineSeries, { lineVisible: false, pointMarkersVisible: false, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider });
      const bandsPrimitive = new BandsPrimitive();
      anchor.attachPrimitive(bandsPrimitive);
      chart.subscribeCrosshairMove((param) => {
        const y = param.point?.y;
        const price = y === undefined ? null : anchor.coordinateToPrice(y);
        setHover(price === null ? null : (liveBands.current.find((b) => price >= b.fromPrice && price < b.toPrice) ?? null));
      });
      live.current = { chart, candles: candlesSeries, anchor, bands: bandsPrimitive, line: null, viewKey: "", dashed: LineStyle.Dashed, bounds: null };
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
    liveBands.current = bands;
  }, [bands]);

  useEffect(() => {
    const c = live.current;
    if (!c) return;
    c.candles.applyOptions({ priceFormat: { type: "price", precision: places, minMove: 1 / 10 ** places } });
    // The library brands its time type; our bars hold UTC seconds, which is what it means.
    c.candles.setData((candleBars ?? []).map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })));
    const key = `${market}:${timeframe}`;
    // A view is fitted once candles are in: the library drops a fit of an empty series.
    if (c.viewKey !== key && candleBars !== undefined && candleBars.length > 0) {
      c.chart.timeScale().fitContent();
      c.viewKey = key;
    }
  }, [ready, candleBars, market, timeframe, places]);

  useEffect(() => {
    const c = live.current;
    if (!c) return;
    const amber = token("amber");
    c.bounds = mark === null ? null : { min: mark * (1 - effectiveBps / 10_000), max: mark * (1 + effectiveBps / 10_000) };
    c.anchor.setData(mark === null || anchorTime === null ? [] : [{ time: anchorTime as UTCTimestamp, value: mark }]);
    c.bands.update({ bands, maxUsd, colour: (weight) => withOpacity(amber, 0.03 + 0.55 * weight) });
    if (c.line !== null) c.candles.removePriceLine(c.line);
    c.line = mark === null ? null : c.candles.createPriceLine({ price: mark, color: token("fg-2"), lineWidth: 1, lineStyle: c.dashed, axisLabelVisible: true, title: "Mark" });
    c.chart.priceScale("right").applyOptions({ autoScale: true });
  }, [ready, bands, maxUsd, mark, effectiveBps, anchorTime]);

  const symbol = markets.find((m) => m.id === market)?.label ?? "";
  const side = (usd: string, count: number) => `${formatCompactUsd(fixedToNumber(fixedFromWire(usd)))} (${count})`;
  const detail = hover === null
    ? null
    : `${formatPrice(hover.fromPrice, places)} to ${formatPrice(hover.toPrice, places)}: long ${formatCompactUsd(hover.longUsd)} (${hover.longCount}), short ${formatCompactUsd(hover.shortUsd)} (${hover.shortCount})`;
  const message = positions.status === "unavailable" && view === null
    ? "This node does not report where positions close out yet. The map appears once it is updated."
    : positions.status === "waiting" && view === null
      ? "The node has not completed its first scan of accounts yet. The map appears when it has."
      : positions.status === "failed" ? feedProblem(positions, "the close-out map") : null;
  const candleBegin = candleBars?.[0];
  const provenance = candles.data?.provenance === "seeded_from_provider" ? "provider-seeded history" : candles.data?.provenance === "log_derived" ? "derived from the node's log" : null;
  const candleNote = candles.status === "unavailable" && candles.data === null
    ? "The node's price history is not available, so candles are not drawn."
    : candleBegin === undefined ? null : `Candles begin ${formatStamp(candleBegin.time * 1000)} UTC${provenance === null ? "" : `, ${provenance}`}${candles.data?.complete === false ? ", and the node's history for this window was cut short" : ""}.`;
  const problems = [message === null ? feedProblem(positions, "the close-out bands") : null, feedProblem(candles, "the candles")].filter((line) => line !== null);
  return (
    <Panel
      title="Close-out map"
      tip="Where accounts close out. Each band is a price range, shaded by the dollars of positions that close out when the index reaches it. Longs close out below the mark, shorts above it."
      className={className}
      controls={
        <>
          <Pick label="Close-out map market" value={market ?? 0} options={markets.map((m) => ({ value: m.id, label: m.label }))} onChange={setPicked} />
          <Pick label="Close-out map candle size" value={timeframe} options={TIMEFRAME_OPTIONS} onChange={setTimeframe} />
          <Pick label="Close-out map price range" value={rangeBps} options={RANGE_OPTIONS} onChange={setRangeBps} />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-fg-3" aria-hidden="true">
        <span className="flex items-center gap-2">$0<span className="h-2 w-24 bg-linear-to-r from-amber/5 to-amber/65" />{formatCompactUsd(maxUsd)}</span>
        <span className="min-h-4 text-fg-2">{detail ?? "Move over the chart to read a band."}</span>
      </div>
      <div className="relative min-h-80 flex-1">
        <div ref={host} role="group" aria-label={`${symbol} close-out map: candles with bands of close-out notional`} className="absolute inset-0 max-lg:[&_a]:after:absolute max-lg:[&_a]:after:-inset-3.5 max-lg:[&_a]:after:content-['']" />
        {message !== null && <div className="absolute inset-0 z-10 flex bg-ink-1"><Quiet>{message}</Quiet></div>}
        {failed && <p role="alert" className="absolute inset-0 z-10 flex items-center justify-center text-caption text-ember">The chart could not load. Reload the page to try again.</p>}
        <DataTable
          summary="Close-out bands as a table"
          caption={`Close-out bands within ${effectiveBps / 100} percent of the ${symbol} mark, lowest price first`}
          columns={["Price range", "Long", "Short"]}
          rows={bands.slice(0, TABLE_BANDS).map((b) => ({ key: b.fromPrice, head: `${formatPrice(b.fromPrice, places)} to ${formatPrice(b.toPrice, places)}`, cells: [`${formatCompactUsd(b.longUsd)}, ${b.longCount} positions`, `${formatCompactUsd(b.shortUsd)}, ${b.shortCount} positions`] }))}
        />
      </div>
      <p className="sr-only">
        {view === null || mark === null ? "" : bands.length === 0 ? "No positions close out within this range." : `${bands.length} close-out bands within ${effectiveBps / 100} percent of the mark; the heaviest holds ${formatCompactUsd(maxUsd)}.`}
      </p>
      {view !== null && (
        <p className="text-label text-fg-3">
          Due now: long {side(view.due_now.long_usd, view.due_now.long_count)}, short {side(view.due_now.short_usd, view.due_now.short_count)}. Beyond the node&apos;s ±{view.closeout_range_bps / 100}% range: long {side(view.beyond_range.long_usd, view.beyond_range.long_count)}, short {side(view.beyond_range.short_usd, view.beyond_range.short_count)}.
          {" "}Bands are the node&apos;s scan at {formatClock(view.snapshot_ms)} UTC, one snapshot with no history along the time axis.
          {candleNote !== null && ` ${candleNote}`}
        </p>
      )}
      {problems.map((line) => <p key={line} className="text-label text-fg-3">{line}</p>)}
    </Panel>
  );
}
