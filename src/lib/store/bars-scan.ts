/**
 * The chart's history for a live node: a bounded signed read of the log's `prices` commands back
 * from the head, folded into index marks and seeded as bars. The read is best-effort but not
 * silent: a failure waits and tries again a couple of times, then tells the user why the chart has
 * no history, and the stream keeps building bars from the live marks either way.
 */

import { barsFromMarks, TIMEFRAMES, type Bar, type TimeframeId } from "../bars";
import type { ScanBudget } from "../engine/live-marks";
import { sessionRule, type SessionRule } from "../engine/mark-session";
import type { MarketId, PriceRules } from "../engine/types";
import type { MarketModel } from "../models";
import type { ConsoleStore } from "./store";

/** The scan starts this many seqs before the head. */
const SCAN_WINDOW_SEQS = 60_000;
/** The scan stops at the first of these, whichever comes first. */
const SCAN_BUDGET: ScanBudget = { maxMessages: 60_000, maxMs: 25_000, coverMs: 1_200_000, stepMs: 1_000 };
/** A failed scan is tried again this many times, each after `RETRY_DELAY_MS`, before it is reported. */
const SCAN_RETRIES = 2;
const RETRY_DELAY_MS = 3_000;

/** What the retry waits on, so a test can run the backoff without real timers. */
export interface ScanClock {
  wait(ms: number): Promise<void>;
}

const realClock: ScanClock = { wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/**
 * Starts the scan; the history it finds merges into the bars the stream built while the scan ran,
 * per market. False when the node has not named a log head yet, so the caller tries again on its
 * next read; true when the scan ran or a retry is pending.
 */
export function scanBarsHistory(store: ConsoleStore, markets: readonly MarketModel[], clock: ScanClock = realClock): boolean {
  const client = store.deps.client;
  const head = client.headSeq;
  if (head === null) return false;
  // Futures-priced markets are not scanned: their index is roll-adjusted with cumulative state a
  // bounded log read cannot reconstruct. Neither are equities: a failed corporate action blocks
  // every quote for a market, and that blocking state lives in the corporate-action history the
  // scan does not replay. Neither are markets quoted in another currency: the engine withholds
  // their marks while the FX market's index is invalid, and the replay models one market's book.
  // All keep the history the stream builds from the node's marks.
  const spot = markets.filter((m) =>
    (m.view.contracts === undefined || m.view.contracts.length === 0)
    && m.view.asset_class !== "equity"
    && m.view.quote_currency === undefined);
  const rules: Record<number, PriceRules> = Object.fromEntries(spot.map((m) => [m.id, m.priceRules]));
  const sessions = Object.fromEntries(spot.map((m) => [m.id, sessionRule(m.view.schedule)]));
  void attempt(store, store.scanEpoch, markets, rules, sessions, Math.max(0, head - SCAN_WINDOW_SEQS), SCAN_RETRIES, clock);
  return true;
}

/** One scan attempt; on failure waits and tries again, and reports once the retries are spent. */
async function attempt(store: ConsoleStore, epoch: number, markets: readonly MarketModel[], rules: Record<number, PriceRules>, sessions: Readonly<Record<number, SessionRule>>, fromSeq: number, retries: number, clock: ScanClock): Promise<void> {
  // Work from an earlier cycle is abandoned: the store stopped, or a new start replaced it.
  const stale = () => store.stopped || store.scanEpoch !== epoch;
  try {
    const marks = await store.deps.client.scanMarks(fromSeq, SCAN_BUDGET, rules, sessions, stale);
    if (stale()) return;
    seedBars(store, markets, marks);
  } catch (error) {
    if (stale()) return;
    if (retries > 0) {
      await clock.wait(RETRY_DELAY_MS);
      if (stale()) return;
      await attempt(store, epoch, markets, rules, sessions, fromSeq, retries - 1, clock);
      return;
    }
    report(store, error);
  }
}

/** Shows a scan that spent its retries; development also logs the reason where the owner can see it. */
function report(store: ConsoleStore, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  if (process.env.NODE_ENV === "development") console.error(`The chart history scan failed: ${reason}`, error);
  store.toast("error", `Chart history unavailable: ${reason}`);
}

/**
 * Seeds `store`'s bars with the scan's marks, per market and timeframe. Scanned history merges
 * with the bars the stream built while the scan ran; nothing a side holds is silently dropped.
 */
function seedBars(store: ConsoleStore, markets: readonly MarketModel[], marks: readonly { market: MarketId; ts: number; mid: number }[]): void {
  if (marks.length === 0) return;
  const bars = { ...store.getSnapshot().bars };
  for (const market of markets) {
    const series = marks.filter((mark) => mark.market === market.id);
    if (series.length === 0) continue;
    const live = bars[market.id];
    // `fromEntries` loses the key type; the keys are exactly the timeframes the store holds.
    bars[market.id] = Object.fromEntries(TIMEFRAMES.map((tf) => [tf.id, mergeHistory(barsFromMarks(series, tf.seconds), live?.[tf.id] ?? [], tf.seconds, lastMarkAt(series, tf.seconds), liveTickedAt(store, market.id, tf.id, tf.seconds))])) as Record<TimeframeId, Bar[]>;
  }
  store.patch({ bars });
}

/** The last mark's time for each bucket a mark series builds, for choosing the later observation at a merge. */
function lastMarkAt(series: readonly { ts: number }[], seconds: number): Map<number, number> {
  const at = new Map<number, number>();
  for (const mark of series) {
    const bucket = Math.floor(mark.ts / 1000 / seconds) * seconds;
    at.set(bucket, Math.max(at.get(bucket) ?? 0, mark.ts));
  }
  return at;
}

/**
 * Merges scanned history with the live bars the stream built during the scan. A bucket both hold
 * takes the scanned open, the extrema of both, and the later observation's close: the scanned one
 * for a bucket the log completed, the live one for the bucket still forming. A live candle that
 * follows the scanned prefix opens at the prefix's close — `pushTick`'s convention for every
 * candle after another — bound against the extremes the bucket's ticks and mark samples actually
 * observed (`observedHigh`/`observedLow`).
 */
/** When a bucket of the market's bars was last ticked, for choosing the later observation at a merge. */
function liveTickedAt(store: ConsoleStore, market: number, tf: TimeframeId, seconds: number): (bucket: number) => number {
  const ticks = store.barTicks[market]?.[tf];
  // A bucket with no recorded tick was last touched no later than its end.
  return (bucket) => ticks?.get(bucket) ?? (bucket + seconds) * 1000;
}

function mergeHistory(scanned: readonly Bar[], live: readonly Bar[], seconds: number, scannedAt: ReadonlyMap<number, number>, liveTickedAt: (bucket: number) => number): Bar[] {
  const byTime = new Map<number, Bar>(scanned.map((bar) => [bar.time, bar]));
  for (const bar of live) {
    const have = byTime.get(bar.time);
    if (have === undefined) {
      byTime.set(bar.time, bar);
      continue;
    }
    // The scanned close wins where its last retained observation is no earlier than the live
    // bar's last tick for this bucket; elsewhere the live close stands. (Thinning can drop a
    // bucket's final prices, so reading past a bucket does not prove its scanned close is the
    // latest observation.)
    const observed = scannedAt.get(bar.time) ?? 0;
    const complete = observed >= liveTickedAt(bar.time);
    byTime.set(bar.time, {
      time: bar.time,
      open: have.open,
      high: Math.max(have.high, bar.high),
      low: Math.min(have.low, bar.low),
      close: complete ? have.close : bar.close,
      observedHigh: Math.max(have.observedHigh, bar.observedHigh),
      observedLow: Math.min(have.observedLow, bar.observedLow),
    });
  }
  const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
  // A merge can move a candle's close; every candle after another then opens at that close, as
  // `pushTick` opens each candle at the previous one — scanned successors included. The reopened
  // candle's extrema are the corrected open set against what the bucket actually observed, never
  // the open it carried: that open may lie outside the observed range, and an observed extreme can
  // coincide with it.
  for (let i = 1; i < merged.length; i++) {
    const prev = merged[i - 1];
    const bar = merged[i];
    if (prev !== undefined && bar !== undefined && bar.open !== prev.close) {
      const open = prev.close;
      merged[i] = {
        ...bar,
        open,
        high: Math.max(open, bar.observedHigh),
        low: Math.min(open, bar.observedLow),
      };
    }
  }
  return merged;
}
