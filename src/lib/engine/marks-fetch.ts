/**
 * The chart's history from the node's marks endpoint: one window per market and timeframe, read in
 * signed pages until the window is covered or the page budget is spent, and folded into bars. This
 * replaces replaying the log for history; a node without the route is read by the archive scan
 * instead (store/bars-seed.ts).
 */

import { barsFromMarks, MAX_BARS, secondsOf, type Bar, type TimeframeId } from "../bars";
import { fixedFromWire, fixedToNumber } from "../fixed";
import type { EngineClient } from "./client";
import type { MarkProvenance, MarkResolution } from "./mark-types";

/**
 * The marks resolution a timeframe fetches. Sub-hour timeframes read 1m marks (60 days of
 * retention fill every sub-hour window at a fraction of the 1s series' size); the 1m timeframe
 * reads 1s marks, since bars built from marks of their own size would hold no intrabar range.
 */
export function resolutionFor(timeframe: TimeframeId): MarkResolution {
  switch (timeframe) {
    case "1m": return "1s";
    case "5m":
    case "15m": return "1m";
    case "1h": return "1h";
    case "1D": return "1d";
  }
}

/** How far back a timeframe's fetch reaches: enough complete bars to fill the chart. */
export function windowSecondsFor(timeframe: TimeframeId): number {
  return secondsOf(timeframe) * MAX_BARS;
}

/** The most pages a window's fetch reads before it keeps the partial window it has. */
export const MARKS_PAGE_LIMIT = 8;

/** The bars folded from one window's marks. */
export interface FetchedBars {
  bars: Bar[];
  /**
   * What the marks came from: `seeded_from_provider` once any fetched entry is provider-seeded
   * (a mixed series reports the provider seeding, since that is the trust-relevant fact),
   * `log_derived` when all fetched entries say so, null when the window held no entries.
   */
  provenance: MarkProvenance | null;
  /** False when the page budget cut the fetch off before the window's start. */
  complete: boolean;
}

/**
 * Fetches `[fromMs, toMs]` of `market`'s marks at `timeframe`'s resolution and folds them into
 * bars of `timeframe`'s size. Pages are followed by `next_from_ms` until the page names none or
 * the page budget is spent; `complete` says which.
 * Error cases:
 * - as `EngineClient.marks`: the node's refusal or an unverifiable answer rejects, and no bars are returned
 */
export async function fetchBarsHistory(client: EngineClient, market: number, timeframe: TimeframeId, fromMs: number, toMs: number): Promise<FetchedBars> {
  const marks: { ts: number; mid: number }[] = [];
  let provenance: MarkProvenance | null = null;
  let cursor = fromMs;
  let complete = true;
  for (let page = 0; ; page++) {
    const answer = await client.marks(market, resolutionFor(timeframe), cursor, toMs);
    for (const entry of answer.entries) marks.push({ ts: entry.t_ms, mid: fixedToNumber(fixedFromWire(entry.mid)) });
    if (answer.entries.some((entry) => entry.provenance === "seeded_from_provider")) provenance = "seeded_from_provider";
    else if (answer.entries.length > 0) provenance = "log_derived";
    if (answer.next_from_ms === null) break;
    // A node that keeps naming a next page without entries or progress would page forever.
    if (page + 1 >= MARKS_PAGE_LIMIT || answer.entries.length === 0 || answer.next_from_ms <= cursor) {
      complete = false;
      break;
    }
    cursor = answer.next_from_ms;
  }
  return { bars: barsFromMarks(marks, secondsOf(timeframe)), provenance, complete };
}
