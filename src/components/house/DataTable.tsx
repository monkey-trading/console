/** A chart's data as a table the keyboard and screen readers can reach: hidden until it takes focus, then laid over the chart's corner. Put it inside the chart's relatively positioned box. */

export interface DataRow {
  key: string | number;
  head: string;
  cells: readonly string[];
}

export function DataTable({ summary, caption, columns, rows }: { summary: string; caption: string; columns: readonly string[]; rows: readonly DataRow[] }) {
  return (
    <details className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:top-1 focus-within:left-1 focus-within:z-20 focus-within:max-h-56 focus-within:max-w-[calc(100%-0.5rem)] focus-within:overflow-auto focus-within:rounded focus-within:border focus-within:border-line-2 focus-within:bg-ink-2 focus-within:p-2 focus-within:text-label">
      <summary className="text-fg-2">{summary}</summary>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{columns.map((column) => <th key={column} scope="col" className="pr-3 text-left font-normal">{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="pr-3 text-left font-normal">{row.head}</th>
              {row.cells.map((cell, i) => <td key={columns[i + 1] ?? i} className="pr-3 tabular-nums">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
