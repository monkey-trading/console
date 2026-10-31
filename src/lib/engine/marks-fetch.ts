/**
 * The chart's history from the node's marks endpoint: one window per market and timeframe, read in
 * signed pages until the window is covered or the page budget is spent, and folded into bars. A
 * window the budget cuts is read again over the newest span of what was fetched, so the bars kept
 * always end at the window's recent edge. This replaces replaying the log for history; a node
 * without the route is read by the archive scan instead (store/bars-seed.ts).
 */

import { barsFromCandles, MAX_BARS, secondsOf, type Bar, type Candle, type TimeframeId } from "../bars";
import { fixedFromWire, fixedToNumber } from "../fixed";
import type { EngineClient } from "./client";
import type { MarkProvenance, MarkResolution } from "./mark-types";

/**
 * The marks resolution a timeframe fetches. Every timeframe reads marks of its own size or finer:
 * candles carry their bucket's range, so a timeframe loses nothing by reading same-size marks, and
 * the seeded depths (60 days of 1m, 2y of 1h/1d) then fill every timeframe's window. The 1s series
 * has no seeded depth — no venue serves 1s candles — so it fills nothing the 1m candles don't.
 */
export function resolutionFor(timeframe: TimeframeId): MarkResolution {
  switch (timeframe) {
    case "1m":
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

/** The most pages one pass over a window reads before it keeps the partial span it reached. */
export const MARKS_PAGE_LIMIT = 8;
/** The most passes over a window, halving toward its recent edge, before the partial is kept. */
export const MARKS_PASSES = 3;

/** The bars folded from one window's marks. */
export interface FetchedBars {
  bars: Bar[];
  /**
   * What the marks came from: `seeded_from_provider` once any fetched entry is provider-seeded
   * (a mixed series reports the provider seeding, since that is the trust-relevant fact),
   * `log_derived` when all fetched entries say so, null when the window held no entries.
   */
  provenance: MarkProvenance | null;
  /** False when the page budget cut the read off before the window's start. */
  complete: boolean;
}

interface WindowRead {
  result: FetchedBars;
  /** The window span the pass covered, `toMs - fromMs`, for the newest-span retry. */
  fetchedMs: number;
  /** True when the pass stopped on the page budget (rather than stalling or covering). */
  retryable: boolean;
}

/** One pass over `[fromMs, toMs]`, following `next` until none, the budget, or a stall. */
async function readWindow(client: EngineClient, market: number, timeframe: TimeframeId, fromMs: number, toMs: number): Promise<WindowRead> {
  const candles: Candle[] = [];
  let provenance: MarkProvenance | null = null;
  let cursor = fromMs;
  let complete = true;
  let retryable = false;
  for (let page = 0; ; page++) {
    const answer = await client.marks(market, resolutionFor(timeframe), cursor, toMs);
    for (const entry of answer.entries) {
      candles.push({
        ts: entry.ts,
        open: fixedToNumber(fixedFromWire(entry.open)),
        high: fixedToNumber(fixedFromWire(entry.high)),
        low: fixedToNumber(fixedFromWire(entry.low)),
        close: fixedToNumber(fixedFromWire(entry.close)),
      });
    }
    if (answer.entries.some((entry) => entry.provenance === "seeded_from_provider")) provenance = "seeded_from_provider";
    else if (provenance === null && answer.entries.length > 0) provenance = "log_derived";
    if (answer.next === null) break;
    // A node that keeps naming a next page without entries or progress would page forever.
    if (page + 1 >= MARKS_PAGE_LIMIT || answer.entries.length === 0 || answer.next <= cursor) {
      complete = false;
      retryable = page + 1 >= MARKS_PAGE_LIMIT && answer.entries.length > 0 && answer.next > cursor;
      // The span the budget reached is what a retry can reread: its next page's start included.
      if (retryable) cursor = answer.next;
      break;
    }
    cursor = answer.next;
  }
  return { result: { bars: barsFromCandles(candles, secondsOf(timeframe)), provenance, complete }, fetchedMs: cursor - fromMs, retryable };
}

/**
 * Fetches `[fromMs, toMs]` of `market`'s marks at `timeframe`'s resolution and folds them into
 * bars of `timeframe`'s size. A pass reads pages by `next` until a page names none or the
 * page budget is spent. When the budget cuts a pass, the next pass reads the newest half of the
 * span it reached, which needs fewer pages; a window denser near its recent edge still ends near
 * `toMs` within the pass cap. A narrowed pass that finds no marks — a market closed through that
 * span, say — keeps the last span read rather than emptying the result.
 * Error cases:
 * - as `EngineClient.marks`: the node's refusal or an unverifiable answer rejects, and no bars are returned
 */
export async function fetchBarsHistory(client: EngineClient, market: number, timeframe: TimeframeId, fromMs: number, toMs: number): Promise<FetchedBars> {
  let read = await readWindow(client, market, timeframe, fromMs, toMs);
  let kept = read.result;
  for (let pass = 1; pass < MARKS_PASSES && !read.result.complete && read.retryable && read.fetchedMs > 1; pass++) {
    read = await readWindow(client, market, timeframe, toMs - Math.floor(read.fetchedMs / 2), toMs);
    // A narrowed window can fall entirely inside a closure; its empty page keeps the span already read.
    if (read.result.bars.length > 0) kept = read.result;
  }
  return kept;
}
