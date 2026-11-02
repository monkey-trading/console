/** The drawn part of the SVG chart: grid, axes, the series, the floor, markers and value tags. It is a pure function of its props and memoised, so a moving crosshair never redraws it. */

import { memo } from "react";

import type { TimeTick } from "@/lib/chart-scale";

/** The theme tokens a series takes its colour from. */
export type Tone = "fg" | "glow" | "ember" | "amber";
export const TONE_VAR: Record<Tone, string> = { fg: "var(--color-fg)", glow: "var(--color-glow)", ember: "var(--color-ember)", amber: "var(--color-amber)" };

/** One series ready to draw: its points already in pixels. */
export interface Drawn {
  id: string;
  tone: Tone;
  kind: "line" | "step" | "area" | "bars";
  /** Pixel points, in time order. */
  xy: readonly (readonly [number, number])[];
  /** Where the area and the bars rise from. */
  baseY: number;
  barWidth: number;
  /** The last value, tagged on the axis: its text and y, after the tags were spread apart. */
  tag: { text: string; y: number } | null;
}

export interface Frame {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Guides {
  yTicks: readonly { y: number; label: string }[];
  xTicks: readonly (TimeTick & { x: number; label: string })[];
  floorY: number | null;
  marks: readonly { x: number; y: number; text: string }[];
}

interface Props {
  frame: Frame;
  series: readonly Drawn[];
  guides: Guides;
  uid: string;
}

const path = (xy: readonly (readonly [number, number])[], step: boolean): string => {
  let d = "";
  xy.forEach(([x, y], i) => {
    const previous = xy[i - 1];
    d += i === 0 ? `M${x.toFixed(1)} ${y.toFixed(1)}` : step && previous !== undefined ? `H${x.toFixed(1)}V${y.toFixed(1)}` : `L${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return d;
};

function ChartPlotView({ frame, series, guides, uid }: Props) {
  const { left, top, right, bottom, width } = frame;
  return (
    <g fontSize="11" style={{ fontFamily: "inherit" }}>
      <defs>
        {series.map((s) => (
          <linearGradient key={s.id} id={`${uid}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={TONE_VAR[s.tone]} stopOpacity="0.22" />
            <stop offset="1" stopColor={TONE_VAR[s.tone]} stopOpacity="0.02" />
          </linearGradient>
        ))}
        <linearGradient id={`${uid}-floor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-ember)" stopOpacity="0.16" />
          <stop offset="1" stopColor="var(--color-ember)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {guides.yTicks.map((tick) => <line key={`y${tick.y}`} x1={left} x2={right} y1={tick.y} y2={tick.y} stroke="var(--color-line)" />)}
      {guides.xTicks.map((tick) => <line key={`x${tick.ts}`} x1={tick.x} x2={tick.x} y1={top} y2={bottom} stroke="var(--color-line)" />)}
      <line x1={right} x2={right} y1={top} y2={bottom} stroke="var(--color-line-2)" />
      <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="var(--color-line-2)" />
      {series.map((s) => {
        const first = s.xy[0];
        const last = s.xy[s.xy.length - 1];
        if (first === undefined || last === undefined) return null;
        const colour = TONE_VAR[s.tone];
        if (s.kind === "bars") return <g key={s.id} fill={colour}>{s.xy.map(([x, y]) => <rect key={x} x={x - s.barWidth / 2} y={Math.min(y, s.baseY)} width={s.barWidth} height={Math.max(1, Math.abs(s.baseY - y))} />)}</g>;
        const line = path(s.xy, s.kind === "step");
        return (
          <g key={s.id}>
            {s.kind === "area" && s.xy.length > 1 && <path d={`${line}L${last[0].toFixed(1)} ${bottom}L${first[0].toFixed(1)} ${bottom}Z`} fill={`url(#${uid}-${s.id})`} />}
            {s.xy.length > 1 ? <path d={line} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" /> : <circle cx={first[0]} cy={first[1]} r="3" fill={colour} />}
          </g>
        );
      })}
      {/* Over the series, so what lies below the floor reads as shaded whatever fills it. */}
      {guides.floorY !== null && (
        <>
          <rect x={left} y={guides.floorY} width={right - left} height={Math.max(0, bottom - guides.floorY)} fill={`url(#${uid}-floor)`} />
          <line x1={left} x2={right} y1={guides.floorY} y2={guides.floorY} stroke="var(--color-ember)" strokeOpacity="0.7" strokeDasharray="4 3" />
        </>
      )}
      {guides.marks.map((mark) => {
        // The label sits beside its arrow, toward the middle of the plot, so it does not cross the line the arrow stands on.
        const toLeft = mark.x > (left + right) / 2;
        return (
          <g key={`${mark.x}${mark.text}`} fill="var(--color-amber)">
            <polygon points={`${mark.x},${mark.y - 3} ${mark.x - 4},${mark.y - 10} ${mark.x + 4},${mark.y - 10}`} />
            <text x={toLeft ? mark.x - 8 : mark.x + 8} y={mark.y - 6} textAnchor={toLeft ? "end" : "start"}>{mark.text}</text>
          </g>
        );
      })}
      <g fill="var(--color-fg-3)">
        {guides.yTicks.map((tick) => <text key={`yl${tick.y}`} x={right + 8} y={tick.y} dominantBaseline="middle">{tick.label}</text>)}
        {guides.xTicks.map((tick) => <text key={`xl${tick.ts}`} x={Math.min(width - 14, tick.x)} y={bottom + 15} textAnchor="middle" fontWeight={tick.major ? 700 : 400} fill={tick.major ? "var(--color-fg-2)" : undefined}>{tick.label}</text>)}
      </g>
      {series.map((s) => s.tag === null ? null : (
        <g key={`tag${s.id}`}>
          <rect x={right} y={s.tag.y - 8} width={width - right} height="16" rx="2" fill={TONE_VAR[s.tone]} />
          <text x={right + 6} y={s.tag.y} dominantBaseline="middle" fill="var(--color-ink)">{s.tag.text}</text>
        </g>
      ))}
    </g>
  );
}

/** Memoised: the chart re-draws only when its data, size or scale change. */
export const ChartPlot = memo(ChartPlotView);
