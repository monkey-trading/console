/**
 * The chart's bars from the node's marks endpoint: seeded once per market and timeframe, replacing
 * the stream-built series, with the stream's ticks that arrived during the fetch merged back in
 * and the stream keeping the series current from then on. A node that 404s the endpoint is an
 * older node: the archive scan seeds the chart instead, asked for through the store's
 * `historyScan` dependency.
 */

import { mergeFetchedBars, TIMEFRAMES, type Bar, type TimeframeId } from "../bars";
import { EngineError } from "../engine/client";
import { fetchBarsHistory, windowSecondsFor } from "../engine/marks-fetch";
import type { MarketId } from "../engine/types";
import type { ConsoleStore } from "./store";

/** The most tries one series gets before its fetch gives up and reports. */
const SEED_ATTEMPTS = 3;

export class BarsSeed {
  /** The market/timeframe series a fetch finished, so each is seeded once per page load. */
  private readonly seeded = new Set<string>();
  /** The market/timeframe series a fetch is reading, so overlapping triggers start one fetch. */
  private readonly pending = new Set<string>();
  /** Attempts per series, so a transient failure retries and a persistent one stops. */
  private readonly attempts = new Map<string, number>();
  /** The series whose failure was already reported, so it is reported once. */
  private readonly reported = new Set<string>();
  /** Whether the node 404'd the marks endpoint; it is an older node, so the archive scan seeds instead. */
  private unavailable = false;
  /** Whether the archive-scan fallback has started; a false start (no log head yet) is asked again. */
  private scanAsked = false;

  constructor(private readonly store: ConsoleStore) {}

  /**
   * Seeds (market, timeframe)'s bars from the marks endpoint. Runs only for a signature-checking
   * client with node time; a market the stream has no bars for yet, such as one first seen
   * closed, is seeded from the fetch alone.
   */
  seed(marketId: MarketId, timeframe: TimeframeId): void {
    if (this.store.deps.client.signatures !== "checked" || this.unavailable || this.store.getSnapshot().now === 0) return;
    const key = `${marketId}:${timeframe}`;
    if (this.seeded.has(key) || this.pending.has(key)) return;
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    this.pending.add(key);
    void this.fetch(key, marketId, timeframe, attempt);
  }

  /** Asks for the archive scan once a node without the endpoint is read again, until it starts. */
  askScan(): void {
    if (this.unavailable) this.askHistoryScan();
  }

  /** Forgets the seeds and the scan's ask, so a restarted store (StrictMode re-runs the effect) works anew. */
  reset(): void {
    this.seeded.clear();
    this.pending.clear();
    this.attempts.clear();
    this.reported.clear();
    this.scanAsked = false;
  }

  /** Reads one timeframe's window of marks and folds it into that series; a 404 turns to the archive scan. */
  private async fetch(key: string, marketId: MarketId, timeframe: TimeframeId, attempt: number): Promise<void> {
    try {
      const toMs = this.store.getSnapshot().now;
      const pre = this.store.getSnapshot().bars[marketId]?.[timeframe] ?? null;
      const fetched = await fetchBarsHistory(this.store.deps.client, marketId, timeframe, toMs - windowSecondsFor(timeframe) * 1000, toMs);
      // No marks for the window is the node's honest answer, not a failure: do not retry it.
      if (fetched.bars.length === 0) {
        this.seeded.add(key);
        return;
      }
      const before = this.store.getSnapshot().bars;
      const current = before[marketId]?.[timeframe] ?? [];
      const series = mergeFetchedBars(fetched.bars, current, pre);
      const per = before[marketId];
      // `fromEntries` loses the key type; the keys are exactly the timeframes `TIMEFRAMES` lists.
      const nextPer = Object.fromEntries(TIMEFRAMES.map((tf) => [tf.id, tf.id === timeframe ? series : (per?.[tf.id] ?? [])])) as Record<TimeframeId, Bar[]>;
      const bars = { ...before, [marketId]: nextPer };
      const barProvenance = fetched.provenance === null ? this.store.getSnapshot().barProvenance
        : { ...this.store.getSnapshot().barProvenance, [marketId]: { ...this.store.getSnapshot().barProvenance[marketId], [timeframe]: fetched.provenance } };
      this.seeded.add(key);
      this.store.patch({ bars, barProvenance });
    } catch (error) {
      if (error instanceof EngineError && error.status === 404) {
        this.unavailable = true;
        this.askHistoryScan();
        return;
      }
      // A transient failure retries on the next trigger; the last one reports once and stops.
      if (attempt >= SEED_ATTEMPTS && !this.seeded.has(key) && !this.reported.has(key)) {
        this.reported.add(key);
        this.seeded.add(key);
        const reason = error instanceof Error ? error.message : "The node did not answer.";
        this.store.toast("error", `Chart history unavailable: ${reason}`);
      }
    } finally {
      this.pending.delete(key);
    }
  }

  /** Starts the archive-scan fallback; un-wired or not-yet-startable answers are asked again on the next read. */
  private askHistoryScan(): void {
    if (this.scanAsked) return;
    this.scanAsked = this.store.deps.historyScan ? this.store.deps.historyScan(this.store, this.store.getSnapshot().markets) : false;
  }
}
