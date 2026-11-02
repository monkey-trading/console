/** The windows a MONKEY chart offers, each read at the resolution whose retention and page size suit it. */

import type { SeriesResolution } from "../engine/stats-types";

export const TIMEFRAMES = [
  { id: "6h", label: "6h", resolution: "1m", bucketMs: 60_000, windowMs: 6 * 3_600_000 },
  { id: "2d", label: "2d", resolution: "1h", bucketMs: 3_600_000, windowMs: 2 * 86_400_000 },
  { id: "7d", label: "7d", resolution: "1h", bucketMs: 3_600_000, windowMs: 7 * 86_400_000 },
  { id: "30d", label: "30d", resolution: "1d", bucketMs: 86_400_000, windowMs: 30 * 86_400_000 },
  { id: "all", label: "All", resolution: "1d", bucketMs: 86_400_000, windowMs: null },
] as const satisfies readonly { id: string; label: string; resolution: SeriesResolution; bucketMs: number; windowMs: number | null }[];

export type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

/** The window `id` names; every id in the union is in the table. */
export function timeframe(id: TimeframeId): (typeof TIMEFRAMES)[number] {
  const found = TIMEFRAMES.find((frame) => frame.id === id);
  if (found === undefined) throw new Error(`Unknown chart timeframe ${id}.`);
  return found;
}
