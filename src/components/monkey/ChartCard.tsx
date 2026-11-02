"use client";

/** A MONKEY chart's card: its title, timeframe and Live switch, the chart, the latest values, and where its data begins. */

import { useSyncExternalStore, type ReactNode } from "react";

import type { ChartFeed } from "@/lib/monkey/feed";
import { latestText } from "@/lib/monkey/figures";
import { TIMEFRAMES, timeframe as frameOf, type TimeframeId } from "@/lib/monkey/timeframes";
import { formatStamp } from "@/lib/time";

import { Select } from "../Select";
import { CHART_HEIGHT, ChartCanvas, type ChartKind, type LineSpec } from "./ChartCanvas";
import { RecentTable } from "./RecentTable";
import { focusHeading } from "./Card";
import { NOTE } from "./styles";

const OPTIONS = TIMEFRAMES.map((frame) => ({ value: frame.id, label: frame.label }));
const SWATCH: Record<LineSpec["tone"], string> = { glow: "bg-glow", amber: "bg-amber", ember: "bg-ember" };

interface Props {
  id: string;
  title: string;
  feed: ChartFeed;
  kind: ChartKind;
  lines: readonly LineSpec[];
  format: (value: number) => string;
  marks?: readonly number[];
  /** What the chart measures, where its title does not say. */
  caption?: string;
  footer?: ReactNode;
}

const NO_MARKS: readonly number[] = [];

/** Where the node's record for this chart begins, and why it might not reach further back. */
function beginsText(begins: number | null, fromGenesis: boolean, retained: number | null): string {
  if (begins === null) return "The node has recorded no data for this chart yet.";
  const parts = [`Data begins ${formatStamp(begins)} UTC`];
  if (!fromGenesis) parts.push("where this node's record restarted from a snapshot, so earlier history is not in it");
  if (retained !== null) parts.push(`and older buckets have been pruned: it holds this series from ${formatStamp(retained)} UTC`);
  return `${parts.join(", ")}.`;
}

export function ChartCard({ id, title, feed, kind, lines, format, marks = NO_MARKS, caption, footer }: Props) {
  const { timeframe, live, read } = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
  const data = read.value;
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-xl border border-line-2 bg-ink-1 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={id} tabIndex={-1} className="text-label tracking-caps text-fg uppercase outline-none">{title}</h3>
        <div className="flex items-center gap-2">
          <div className="w-24 [&>div>span:first-child]:sr-only">
            <Select<TimeframeId> label={`${title} timeframe`} value={timeframe} options={OPTIONS} onChange={(value) => feed.setTimeframe(value)} />
          </div>
          <button type="button" aria-pressed={live} onClick={() => feed.setLive(!live)} className={`min-h-11 rounded border px-2 text-label tracking-caps uppercase focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0 ${live ? "border-glow text-glow" : "border-line-2 text-fg-3 hover:text-fg"}`}>Live<span className="sr-only">: refresh this chart every few seconds</span></button>
        </div>
      </div>
      {caption !== undefined && <p className={`${NOTE} mt-1`}>{caption}</p>}
      {lines.length > 1 && (
        <p className="mt-2 flex flex-wrap gap-x-4 text-label text-fg-2" aria-hidden="true">
          {lines.map((line) => <span key={line.metric} className="inline-flex items-center gap-1.5"><span className={`inline-block h-0.5 w-3 ${SWATCH[line.tone]}`} />{line.label}</span>)}
        </p>
      )}
      <div className="mt-2">
        {read.status === "unavailable" ? (
          <p className={`${NOTE} flex items-center ${CHART_HEIGHT}`}>This node does not serve this chart&apos;s data yet.</p>
        ) : data === null ? (
          read.status === "failed" ? (
            <p role="status" className={`flex flex-wrap content-center items-center gap-2 text-caption text-amber ${CHART_HEIGHT}`}>Could not read this chart: {(read.message ?? "the read failed").replace(/\.+$/, "")}. <button type="button" onClick={() => void feed.load().then(() => focusHeading(id))} className="min-h-6 rounded border border-line-2 px-2 text-fg-2 hover:text-glow focus-visible:outline-2 focus-visible:outline-glow">Try again</button></p>
          ) : <p className={`${NOTE} flex items-center ${CHART_HEIGHT}`}>Reading the chart&apos;s data…</p>
        ) : (
          <ChartCanvas kind={kind} lines={lines} data={data} seriesKey={data.timeframe} format={format} marks={marks} label={`${title} chart`} />
        )}
      </div>
      {data !== null && (
        <>
          <p className="sr-only">{title}: {lines.map((line) => `${line.label} ${latestText(data.units[line.metric] ?? "", data.latest[line.metric])}`).join("; ")}.</p>
          <p className="mt-2 text-label text-fg-2" aria-hidden="true">{lines.map((line) => `${lines.length > 1 ? `${line.label} ` : "Latest "}${latestText(data.units[line.metric] ?? "", data.latest[line.metric])}`).join("  ·  ")}</p>
          <p className={`${NOTE} mt-1`}>{beginsText(data.begins_ms, data.from_genesis, data.retained_from_ms)}</p>
          {data.lines[lines[0]?.metric ?? ""]?.length === 0 && <p className={NOTE}>No buckets fall in this window.</p>}
          <RecentTable title={title} lines={lines} data={data} format={format} />
        </>
      )}
      {data !== null && read.status === "failed" && (
        <p role="status" className="mt-1 text-caption text-amber">
          Could not read the {frameOf(timeframe).label} window: {(read.message ?? "the read failed").replace(/\.+$/, "")}. The chart shows the {frameOf(data.timeframe).label} window it already holds.{" "}
          <button type="button" onClick={() => void feed.load().then(() => focusHeading(id))} className="min-h-6 rounded border border-line-2 px-2 text-fg-2 hover:text-glow focus-visible:outline-2 focus-visible:outline-glow">Try again</button>
        </p>
      )}
      {data !== null && read.status === "ready" && read.message !== null && <p role="status" className="mt-1 text-caption text-amber">The last live refresh failed: {read.message.replace(/\.+$/, "")}.</p>}
      {footer}
    </section>
  );
}
