/** A chart's latest buckets as a table the keyboard and a screen reader can reach: hidden until it takes focus. */

import type { ChartData } from "@/lib/monkey/feed";
import { formatStamp } from "@/lib/time";

import type { LineSpec } from "./ChartCanvas";

/** Buckets listed. */
const ROWS = 30;

export function RecentTable({ title, lines, data, format }: { title: string; lines: readonly LineSpec[]; data: ChartData; format: (value: number) => string }) {
  const first = lines[0] === undefined ? [] : (data.lines[lines[0].metric] ?? []);
  const rows = first.slice(-ROWS).reverse();
  return (
    <details className="sr-only focus-within:not-sr-only focus-within:mt-2 focus-within:block focus-within:max-h-56 focus-within:overflow-auto focus-within:rounded focus-within:border focus-within:border-line-2 focus-within:bg-ink-2 focus-within:p-2 focus-within:text-label">
      <summary className="text-fg-2">{title}: latest buckets as a table</summary>
      <table>
        <caption className="sr-only">The latest {rows.length} buckets of {title}, newest first. Times are UTC.</caption>
        <thead>
          <tr><th scope="col">Bucket start (UTC)</th>{lines.map((line) => <th key={line.metric} scope="col">{line.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ms}>
              <th scope="row">{formatStamp(row.ms)}</th>
              {lines.map((line) => {
                const point = (data.lines[line.metric] ?? []).find((candidate) => candidate.ms === row.ms);
                return <td key={line.metric}>{point === undefined ? "—" : format(point.value)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
