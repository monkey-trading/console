"use client";

/**
 * The console's own chart for the House, MONKEY and Staking pages: lines, steps, areas and bars over time
 * in SVG, with a value axis on the right, a tag for each series' last value, an optional dashed
 * floor, markers, and a crosshair whose readout works from the pointer and from the keyboard
 * (arrow keys, Home, End, Escape). Points are thinned to the chart's pixel width and the drawing
 * is redone only when the data, the size or the scale changes, so thousands of points stay smooth.
 * Only the close-out map and the Trade page's candles use a charting library.
 */

import { useId, useMemo, useState } from "react";

import { niceTicks, nearestIndex, placeMarks, spreadTags, thin, timeLabel, timeTicks, valueAt, valueDomain, type ChartPoint, type Mark } from "@/lib/chart-scale";
import { formatStamp } from "@/lib/time";

import { ChartPlot, TONE_VAR, type Drawn, type Frame, type Guides, type Tone } from "./ChartPlot";
import { useSize } from "./use-size";

export type { Tone };

/** One plotted series. */
export interface ChartSeries {
  id: string;
  label: string;
  tone: Tone;
  kind: "line" | "step" | "area" | "bars";
  points: readonly ChartPoint[];
}

interface Props {
  series: readonly ChartSeries[];
  /** Shades everything below this value with a dashed line on it, when set. */
  floor?: number | null;
  /** Arrows over the first series where something happened, such as a halving. */
  marks?: readonly Mark[];
  /** The series cannot go below zero, so the axis does not: it starts at $0. */
  nonNegative?: boolean;
  format: (value: number) => string;
  /** What the chart shows, for its accessible name. */
  label: string;
  /** Classes for the box the chart fills; it takes its size from them. */
  className?: string;
}

const MIN_AXIS = 46;
const CHAR_PX = 6.6;
const TOP = 10;
const BOTTOM_AXIS = 24;
const NO_MARKS: readonly Mark[] = [];

/** Words that say what the keys do, for a screen reader's description of the chart. The chart is a slider over its points: its value text is the readout. */
const HELP = "Use the left and right arrow keys to read each point's values, Home and End for the first and last, Escape to clear.";

const sanitize = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, "");

export function Chart({ series, floor = null, marks = NO_MARKS, nonNegative = false, format, label, className = "relative min-h-52 flex-1" }: Props) {
  const { ref, width, height } = useSize<HTMLDivElement>();
  const uid = sanitize(useId());
  const [cursor, setCursor] = useState<number | null>(null);
  const bars = series.some((s) => s.kind === "bars");
  const lead = series.find((s) => s.points.length > 0);
  const drawn = useMemo(() => {
    if (width === 0 || height === 0) return null;
    const values = [...series.flatMap((s) => s.points.map((p) => p.value)), ...(floor === null ? [] : [floor])];
    const domain = valueDomain(values, nonNegative, bars);
    const yTickValues = niceTicks(domain, Math.max(2, Math.floor((height - BOTTOM_AXIS - TOP) / 36)));
    const labels = yTickValues.map(format);
    const lasts = series.map((s) => s.points[s.points.length - 1]);
    const tagTexts = lasts.map((p) => (p === undefined ? "" : format(p.value)));
    const axis = Math.max(MIN_AXIS, Math.ceil(Math.max(0, ...labels.map((l) => l.length), ...tagTexts.map((t) => t.length)) * CHAR_PX) + 14);
    const frame: Frame = { width, height, left: 4, top: TOP, right: Math.max(40, width - axis), bottom: Math.max(TOP + 20, height - BOTTOM_AXIS) };
    const stamps = series.flatMap((s) => s.points.map((p) => p.ts));
    const first = Math.min(...stamps);
    const last = Math.max(...stamps);
    // Bars are as wide as the gap between buckets, so the first and last sit inside the plot.
    const gaps = (lead?.points ?? []).flatMap((p, i, all) => (i === 0 ? [] : [p.ts - (all[i - 1]?.ts ?? p.ts)])).filter((g) => g > 0);
    const gap = gaps.length === 0 ? 0 : Math.min(...gaps);
    const from = bars && gap > 0 ? first - gap / 2 : first;
    const to = bars && gap > 0 ? last + gap / 2 : last;
    const plotW = frame.right - frame.left;
    const x = (ts: number) => (to === from ? frame.left + plotW / 2 : frame.left + ((ts - from) / (to - from)) * plotW);
    const y = (value: number) => frame.top + (1 - (value - domain.min) / (domain.max - domain.min)) * (frame.bottom - frame.top);
    const tagY = spreadTags(lasts.map((p) => (p === undefined ? 0 : y(p.value))), 18, frame.top + 8, frame.bottom - 8);
    const tagged = new Set(tagY.map((ty) => Math.round(ty)));
    const items: Drawn[] = series.map((s, i) => {
      const point = lasts[i];
      return {
        id: sanitize(s.id), tone: s.tone, kind: s.kind, baseY: y(Math.max(domain.min, 0)),
        barWidth: gap > 0 ? Math.max(2, (gap / (to - from)) * plotW * 0.7) : 8,
        xy: thin(s.points, Math.ceil(plotW)).map((p) => [x(p.ts), y(p.value)] as const),
        tag: point === undefined ? null : { text: tagTexts[i] ?? "", y: tagY[i] ?? 0 },
      };
    });
    const { step, ticks } = timeTicks(from, to, Math.max(1, Math.floor(plotW / 84)));
    const guides: Guides = {
      // A tick label under a value tag would print over it: the grid line stays, the label goes.
      yTicks: yTickValues.map((v, i) => ({ y: y(v), label: [...tagged].some((ty) => Math.abs(ty - y(v)) < 9) ? "" : (labels[i] ?? "") })),
      xTicks: ticks.map((tick) => ({ ...tick, x: x(tick.ts), label: timeLabel(tick, step) })),
      floorY: floor === null ? null : y(floor),
      marks: placeMarks(marks, lead?.points ?? []).flatMap((mark) => {
        const at = lead?.points.find((p) => p.ts === mark.ts);
        return at === undefined ? [] : [{ x: x(mark.ts), y: y(at.value), text: mark.text }];
      }),
    };
    return { frame, items, guides, x, y, from, to };
  }, [series, floor, marks, nonNegative, bars, lead, format, width, height]);

  const points = lead?.points ?? [];
  const at = cursor === null ? -1 : nearestIndex(points, cursor);
  const cursorTs = points[at]?.ts ?? null;
  const readout = cursorTs === null ? null : { when: `${formatStamp(cursorTs)} UTC`, values: series.map((s) => ({ id: s.id, label: s.label, tone: s.tone, value: valueAt(s.points, cursorTs, Number.POSITIVE_INFINITY) })) };
  const text = readout === null ? "" : `${readout.when}: ${readout.values.map((v) => `${v.label} ${v.value === null ? "no value" : format(v.value)}`).join(", ")}`;
  const step = (to: number) => setCursor(points[Math.min(points.length - 1, Math.max(0, to))]?.ts ?? null);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (points.length === 0) return;
    const move = { ArrowLeft: at < 0 ? points.length - 1 : at - 1, ArrowRight: at < 0 ? points.length - 1 : at + 1, Home: 0, End: points.length - 1 }[event.key];
    if (move !== undefined) {
      event.preventDefault();
      step(move);
    } else if (event.key === "Escape" && cursor !== null) {
      event.preventDefault();
      setCursor(null);
    }
  };
  const onPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drawn === null) return;
    const box = event.currentTarget.getBoundingClientRect();
    const px = Math.min(drawn.frame.right, Math.max(drawn.frame.left, event.clientX - box.left));
    setCursor(drawn.from + ((px - drawn.frame.left) / (drawn.frame.right - drawn.frame.left)) * (drawn.to - drawn.from));
  };
  const cx = drawn === null || cursorTs === null ? null : drawn.x(cursorTs);
  return (
    <div
      ref={ref} role="slider" aria-label={label} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={Math.max(0, points.length - 1)} aria-valuenow={Math.max(0, at)} aria-valuetext={text === "" ? "No data" : text}
      aria-describedby={`${uid}-help`} tabIndex={0} onKeyDown={onKeyDown} onFocus={() => { if (cursor === null) step(points.length - 1); }} onBlur={() => setCursor(null)}
      className={`${className} outline-none focus-visible:outline-2 focus-visible:outline-glow`}
    >
      {drawn !== null && (
        <svg width={width} height={height} aria-hidden="true" className="absolute inset-0 touch-pan-y select-none" onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setCursor(null)}>
          <ChartPlot frame={drawn.frame} series={drawn.items} guides={drawn.guides} uid={uid} />
          {cx !== null && (
            <g pointerEvents="none">
              <line x1={cx} x2={cx} y1={drawn.frame.top} y2={drawn.frame.bottom} stroke="var(--color-edge)" strokeDasharray="3 3" />
              {readout?.values.map((v) => v.value === null ? null : <circle key={v.id} cx={cx} cy={drawn.y(v.value)} r="4" fill={TONE_VAR[v.tone]} stroke="var(--color-ink-1)" strokeWidth="2" />)}
            </g>
          )}
        </svg>
      )}
      {readout !== null && (
        <div aria-hidden="true" className="pointer-events-none absolute top-1 left-2 z-10 max-w-[calc(100%-5rem)] rounded border border-line-2 bg-ink-2 px-2 py-1 text-label text-fg-2 shadow-platform">
          <p className="text-fg-3">{readout.when}</p>
          {readout.values.map((v) => <p key={v.id} style={{ color: TONE_VAR[v.tone] }}>{series.length > 1 || v.label !== "" ? `${v.label} ` : ""}{v.value === null ? "—" : format(v.value)}</p>)}
        </div>
      )}
      <p id={`${uid}-help`} className="sr-only">{HELP}</p>
    </div>
  );
}
