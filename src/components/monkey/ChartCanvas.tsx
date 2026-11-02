"use client";

/**
 * A MONKEY chart: the console's own SVG chart (`../charts/Chart`) over the feed's points. Every
 * MONKEY metric is a count, a total or a ratio, so none draws an axis below zero.
 */

import { useMemo } from "react";

import type { ChartData } from "@/lib/monkey/feed";

import { Chart, type ChartSeries } from "../charts/Chart";

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
  /** Held constant by the caller. */
  lines: readonly LineSpec[];
  data: ChartData | null;
  format: (value: number) => string;
  /** Times to mark with a halving arrow on the first line. */
  marks: readonly number[];
  label: string;
}

const KIND = { bars: "bars", steps: "step", lines: "line", area: "area" } as const satisfies Record<ChartKind, ChartSeries["kind"]>;

export function ChartCanvas({ kind, lines, data, format, marks, label }: Props) {
  const series: ChartSeries[] = useMemo(
    () => lines.map((spec) => ({ id: spec.metric, label: spec.label, tone: spec.tone, kind: KIND[kind], points: (data?.lines[spec.metric] ?? []).map((point) => ({ ts: point.ms, value: point.value })) })),
    [lines, data, kind],
  );
  // A halving shows on the first point at or after it, and not at all before the window.
  const halvings = useMemo(() => marks.map((ts) => ({ ts, text: "Halving" })), [marks]);
  return <Chart series={series} marks={halvings} nonNegative format={format} label={label} className={`relative w-full ${CHART_HEIGHT}`} />;
}
