/**
 * The chart's bars from the node's marks endpoint: seeded once per market and timeframe, replacing
 * the stream-built series, with the stream keeping the seeded series current from then on. A node
 * that 404s the endpoint is an older node: the archive scan seeds the chart instead, asked for
 * through the store's `historyScan` dependency.
 */

import { EngineError } from "../engine/client";
import { fetchBarsHistory, windowSecondsFor } from "../engine/marks-fetch";
import type { MarketId } from "../engine/types";
import type { TimeframeId } from "../bars";
import type { ConsoleStore } from "./store";

export class BarsSeed {
  /** The market/timeframe series already seeded, so each is fetched once per page load. */
  private readonly seeded = new Set<string>();
  /** Whether the node 404'd the marks endpoint; it is an older node, so the archive scan seeds instead. */
  private unavailable = false;
  /** Whether the archive-scan fallback has been asked for; a false answer (no log head yet) asks again. */
  private scanAsked = false;

  constructor(private readonly store: ConsoleStore) {}

  /**
   * Seeds (market, timeframe)'s bars from the marks endpoint. Runs only for a signature-checking
   * client with node time and bars the stream already started.
   */
  seed(marketId: MarketId, timeframe: TimeframeId): void {
    if (this.store.deps.client.signatures !== "checked" || this.unavailable) return;
    const key = `${marketId}:${timeframe}`;
    const bars = this.store.getSnapshot().bars;
    if (this.seeded.has(key) || bars[marketId] === undefined || this.store.getSnapshot().now === 0) return;
    this.seeded.add(key);
    void this.fetch(marketId, timeframe);
  }

  /** Asks for the archive scan once a node without the endpoint is read again, until it names a log head. */
  askScan(): void {
    if (this.unavailable) this.askHistoryScan();
  }

  /** Reads one timeframe's window of marks and folds it into that series; a 404 turns to the archive scan. */
  private async fetch(marketId: MarketId, timeframe: TimeframeId): Promise<void> {
    try {
      const toMs = this.store.getSnapshot().now;
      const fetched = await fetchBarsHistory(this.store.deps.client, marketId, timeframe, toMs - windowSecondsFor(timeframe) * 1000, toMs);
      const bars = this.store.getSnapshot().bars;
      if (fetched.bars.length === 0 || bars[marketId] === undefined) return;
      const next = { ...bars, [marketId]: { ...bars[marketId], [timeframe]: fetched.bars } };
      const barProvenance = fetched.provenance === null ? this.store.getSnapshot().barProvenance
        : { ...this.store.getSnapshot().barProvenance, [marketId]: { ...this.store.getSnapshot().barProvenance[marketId], [timeframe]: fetched.provenance } };
      this.store.patch({ bars: next, barProvenance });
    } catch (error) {
      if (error instanceof EngineError && error.status === 404) {
        this.unavailable = true;
        this.askHistoryScan();
        return;
      }
      // Any other failure keeps the stream-built bars; the chart is no worse than without the fetch.
    }
  }

  /** Asks the archive-scan fallback once; an unwired or not-yet-startable scan is asked again on the next read. */
  private askHistoryScan(): void {
    if (this.scanAsked) return;
    this.scanAsked = this.store.deps.historyScan?.(this.store, this.store.getSnapshot().markets) ?? true;
  }
}
