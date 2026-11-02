"use client";

/**
 * A chart panel over one or more of the node's series: timeframe and Live controls (and a market
 * select where the series is per market), the current figure of each line above the chart, and a
 * line that says where the chart's data begins, and how it was sampled where it is. It reads
 * through `useFeed`, so its feeds run only while it is on screen.
 */

import { memo, useMemo, useState } from "react";

import type { SeriesMetric } from "@/lib/engine/stats-types";
import type { MarketId } from "@/lib/engine/types";
import { formatCompactUsd } from "@/lib/chart-format";
import { beginsText, DEFAULT_RANGE, payoutMarks, payoutsText, RANGES, tableRows, type RangeId } from "@/lib/house-series";
import { feedProblem } from "@/lib/store/house-feed-text";
import { SCAN_EVERY_MS, seriesFeed } from "@/lib/store/house-feeds";
import { formatStamp } from "@/lib/time";

import { useSession } from "../ConsoleProvider";
import { Chart, type ChartSeries, type Tone } from "../charts/Chart";
import { Pick } from "./Controls";
import { DataTable } from "./DataTable";
import { Panel, Quiet, Term } from "./Panel";
import { useFeed, useFeeds } from "./use-feed";

/** One line of a series panel. */
export interface LineSpec {
  id: string;
  metric: SeriesMetric;
  label: string;
  /** What the line's figure means, shown on hover and focus. */
  tip: string;
  tone: Tone;
  area?: boolean;
  /** The line cannot go below zero, so its chart's axis never does. */
  nonNegative?: boolean;
  /** The node measures the line by a periodic scan of every account, so what opens and closes between two scans is not in it. */
  sampled?: boolean;
}

/** What the footnote says of a sampled line. The answers carry the time of the last scan but not how often the node scans, so it says periodic. */
const SAMPLED = "These figures are the node's periodic scan of every account, so a position opened and closed between two scans does not show.";

interface Props {
  title: string;
  tip: string;
  lines: readonly LineSpec[];
  /** The markets a per-market series can be read for; null for a series that covers the house. */
  markets: readonly { id: MarketId; label: string }[] | null;
  /** The fresher figures the page already holds, by line id (`<market>:<line id>` for a per-market chart); the chart's last bucket stands in where one is missing. */
  currents?: Readonly<Record<string, number | null>>;
  /** Shades the plane below this value. */
  floor?: number | null;
  /** A line about a figure the chart leans on beyond its own series, such as a floor that may be old. */
  note?: string | null;
  /** Marks on the first line each epoch that paid stakers, so a step down in NAV explains itself. */
  stakerPayouts?: boolean;
  className?: string;
}

const TEXT = { fg: "text-fg", glow: "text-glow", ember: "text-ember", amber: "text-amber" } as const satisfies Record<Tone, string>;

/** The most points the keyboard-reachable table lists. */
const TABLE_POINTS = 30;

function SeriesPanelView({ title, tip, lines, markets, currents, floor = null, note = null, stakerPayouts = false, className }: Props) {
  const { store } = useSession();
  const [range, setRange] = useState<RangeId>(DEFAULT_RANGE);
  const [picked, setPicked] = useState<MarketId | null>(null);
  const market = markets === null ? null : (picked !== null && markets.some((m) => m.id === picked) ? picked : (markets[0]?.id ?? null));
  const first = lines[0];
  const current = (id: string): number | null => currents?.[markets === null ? id : `${market}:${id}`] ?? null;
  const specs = useMemo(() => (markets !== null && market === null ? [] : lines.map((line) => seriesFeed(store, line.metric, market, range))), [store, lines, markets, market, range]);
  const states = useFeeds(specs);
  const plotted: ChartSeries[] = useMemo(() => lines.map((line, i) => ({ id: `${line.id}:${market ?? "-"}`, label: line.label, tone: line.tone, kind: line.area === true ? "area" as const : "line" as const, points: states[i]?.data?.points ?? [] })), [lines, market, states]);
  const payoutFeed = useFeed(useMemo(() => (stakerPayouts ? seriesFeed(store, "distributed_per_epoch", null, range, SCAN_EVERY_MS) : null), [store, stakerPayouts, range]));
  const payouts = payoutFeed.data?.points ?? null;
  const marks = useMemo(() => (payouts === null ? [] : payoutMarks(payouts)), [payouts]);
  const nonNegative = lines.every((line) => line.nonNegative === true);
  const data = states[0]?.data ?? null;
  // A node that stops serving a route keeps the chart it already holds; only a chart with nothing to show says it is not available.
  const unavailable = states.length > 0 && states.every((s) => s.status === "unavailable" && s.data === null);
  const problem = states.map((s) => feedProblem(s, title.toLowerCase())).find((line) => line !== null) ?? null;
  const rows = tableRows(states.map((s) => s.data?.points ?? []), TABLE_POINTS).map((row) => ({ key: row.ts, head: formatStamp(row.ts), cells: row.values.map((value) => (value === null ? "" : formatCompactUsd(value))) }));
  if (first === undefined) return null;
  return (
    <Panel
      title={title}
      tip={tip}
      className={className}
      controls={
        <>
          {markets !== null && <Pick label={`${title} market`} value={market ?? 0} options={markets.map((m) => ({ value: m.id, label: m.label }))} onChange={setPicked} />}
          <Pick label={`${title} timeframe`} value={range} options={RANGES.map((r) => ({ value: r.id, label: r.label }))} onChange={setRange} />
        </>
      }
    >
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-data">
        {lines.map((line, i) => {
          const value = current(line.id) ?? states[i]?.data?.points.at(-1)?.value ?? null;
          return <span key={line.id} className={TEXT[line.tone]}><span className="text-fg-3"><Term label={line.label} tip={line.tip} /> </span>{value === null ? "—" : formatCompactUsd(value)}</span>;
        })}
      </p>
      {unavailable ? (
        <Quiet>This node does not serve its history yet, so there is no chart. It appears once the node is updated.</Quiet>
      ) : (
        <>
          <div className="relative flex min-h-52 flex-1 flex-col">
            <Chart series={plotted} nonNegative={nonNegative} marks={marks} floor={floor} format={formatCompactUsd} label={`${title} chart, ${RANGES.find((r) => r.id === range)?.label ?? range}`} />
            <DataTable summary={`${title} as a table`} caption={`The latest ${rows.length} buckets of ${title}, newest first`} columns={["Time (UTC)", ...lines.map((line) => line.label)]} rows={rows} />
          </div>
          <p className="text-label text-fg-3">
            {states.length === 0 || states.every((s) => s.status === "loading") ? "Reading the node's signed history…" : data === null ? null : beginsText(data, formatStamp)}
            {lines.some((line) => line.sampled === true) && ` ${SAMPLED}`}
            {payouts !== null && ` ${payoutsText(payouts, formatStamp)}`}
            {problem !== null && ` ${problem}`}
            {note !== null && ` ${note}`}
          </p>
        </>
      )}
    </Panel>
  );
}

/** Memoised on its props, so the stream's patches do not re-render it. */
export const SeriesPanel = memo(SeriesPanelView);
