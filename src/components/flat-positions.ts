/** The Positions tab's list as one array. */

import type { ReactElement } from "react";

/**
 * The hedges' headings and rows, then the Others heading and rows, as one flat array of keyed elements. React reconciles each
 * nested array of a parent's children separately, so a row in a different array than before is mounted again, losing its focus,
 * though its key is unchanged: a row whose position enters or leaves a hedge keeps its element only within a single array.
 */
export function flatPositions<R>(
  hedges: readonly { heading: ReactElement; rows: readonly R[] }[],
  others: { heading: ReactElement | null; rows: readonly R[] },
  row: (row: R) => ReactElement | null | readonly (ReactElement | null)[],
): ReactElement[] {
  const rendered = (rows: readonly R[]) => rows.flatMap((r) => row(r) ?? []);
  return [...hedges.flatMap((hedge) => [hedge.heading, ...rendered(hedge.rows)]), ...(others.heading === null ? [] : [others.heading]), ...rendered(others.rows)]
    .filter((element) => element !== null);
}
