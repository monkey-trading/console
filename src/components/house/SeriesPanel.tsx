"use client";

/**
 * A chart panel over one or more of the node's series: timeframe and Live controls (and a market
 * select where the series is per market), the current figure of each line above the chart, and a
 * line that says where the chart's data begins. It reads through `useFeed`, so its feeds run only
 * while it is on screen.
 */

import { memo, useMemo, useState } from "react";

import type { SeriesMetric } from "@/lib/engine/stats-types";
import type { MarketId } from "@/lib/engine/types";
import { formatCompactUsd } from "@/lib/chart-format";
import { beginsText, DEFAULT_RANGE, RANGES, tableRows, type RangeId } from "@/lib/house-series";
import { feedProblem } from "@/lib/store/house-feed-text";
import { seriesFeed } from "@/lib/store/house-feeds";
import { formatStamp } from "@/lib/time";

import { useSession } from "../ConsoleProvider";
import type { Tone } from "./chart-theme";
import { LiveToggle, Pick } from "./Controls";
import { DataTable } from "./DataTable";
import { Panel, Quiet, Term } from "./Panel";
import { SeriesChart, type ChartLine } from "./SeriesChart";
import { useFeeds } from "./use-feed";

/** One line of a series panel. */
export interface LineSpec {
  id: string;
  metric: SeriesMetric;
  label: string;
  /** What the line's figure means, shown on hover and focus. */
  tip: string;
  tone: Tone;
  area?: boolean;
}

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
  className?: string;
}

const TEXT = { fg: "text-fg", glow: "text-glow", ember: "text-ember", amber: "text-amber" } as const satisfies Record<Tone, string>;

/** The most points the keyboard-reachable table lists. */
const TABLE_POINTS = 30;

function SeriesPanelView({ title, tip, lines, markets, currents, floor = null, note = null, className }: Props) {
  const { store } = useSession();
  const [range, setRange] = useState<RangeId>(DEFAULT_RANGE);
  const [live, setLive] = useState(false);
  const [picked, setPicked] = useState<MarketId | null>(null);
  const market = markets === null ? null : (picked !== null && markets.some((m) => m.id === picked) ? picked : (markets[0]?.id ?? null));
  const first = lines[0];
  const current = (id: string): number | null => currents?.[markets === null ? id : `${market}:${id}`] ?? null;
  const specs = useMemo(() => (markets !== null && market === null ? [] : lines.map((line) => seriesFeed(store, line.metric, market, range, live))), [store, lines, markets, market, range, live]);
  const states = useFeeds(specs);
  const plotted: ChartLine[] = useMemo(() => lines.map((line, i) => ({ id: `${line.id}:${market ?? "-"}`, tone: line.tone, area: line.area, points: states[i]?.data?.points ?? [] })), [lines, market, states]);
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
          <LiveToggle live={live} onChange={setLive} />
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
            <SeriesChart lines={plotted} floor={floor} viewKey={`${market ?? "-"}:${range}`} format={formatCompactUsd} label={`${title} chart, ${RANGES.find((r) => r.id === range)?.label ?? range}`} />
            <DataTable summary={`${title} as a table`} caption={`The latest ${rows.length} buckets of ${title}, newest first`} columns={["Time (UTC)", ...lines.map((line) => line.label)]} rows={rows} />
          </div>
          <p className="text-label text-fg-3">
            {states.length === 0 || states.every((s) => s.status === "loading") ? "Reading the node's signed history…" : data === null ? null : beginsText(data, formatStamp)}
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
