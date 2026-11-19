/**
 * The chart's bars from the node's marks endpoint: seeded once per market and timeframe, replacing
 * the stream-built series, with the stream's ticks that arrived during the fetch merged back in
 * and the stream keeping the series current from then on. A node that 404s the endpoint is an
 * older node: the archive scan seeds the chart instead, asked for through the store's
 * `historyScan` dependency. A move to another node's store carries the bars already shown, which the
 * new node's marks merge into rather than replace (monkey-trading/console#426).
 */

import { mergeFetchedBars, TIMEFRAMES, type Bar, type TimeframeId } from "../bars";
import { EngineError } from "../engine/client";
import { fetchBarsHistory, windowSecondsFor } from "../engine/marks-fetch";
import type { MarketId } from "../engine/types";
import { HISTORY_UNAVAILABLE } from "./bars-scan";
import type { ConsoleState } from "./state";
import type { ConsoleStore } from "./store";
import { awaitsTrust } from "./signing";

/** The most tries one series gets before its fetch gives up and reports. */
const SEED_ATTEMPTS = 3;
/** A node still importing its earlier history answers 503: the wait before asking again is its `Retry-After`, kept within these bounds. */
const NOT_READY_MIN_MS = 1_000;
const NOT_READY_MAX_MS = 30_000;
const NOT_READY_DEFAULT_MS = 5_000;
/** The most a series waits on a node that is not ready before it reports. */
const NOT_READY_BUDGET_MS = 240_000;

export class BarsSeed {
  /** The market/timeframe series a fetch finished, so each is seeded once per page load. */
  private readonly seeded = new Set<string>();
  /** The market/timeframe series a fetch is reading, so overlapping triggers start one fetch. */
  private readonly pending = new Set<string>();
  /** Attempts per series, so a transient failure retries and a persistent one stops. */
  private readonly attempts = new Map<string, number>();
  /** The series whose failure was already reported, so it is reported once. */
  private readonly reported = new Set<string>();
  /** The pending waits on a node that is not ready yet, by series; a series with one is not fetched again until it fires. */
  private readonly waiting = new Map<string, ReturnType<typeof setTimeout>>();
  /** How long each series has waited on a node that is not ready, against `NOT_READY_BUDGET_MS`. */
  private readonly waited = new Map<string, number>();
  /** Whether the node 404'd the marks endpoint; it is an older node, so the archive scan seeds instead. */
  private unavailable = false;
  /** Whether the archive-scan fallback has started; a false start (no log head yet) is asked again. */
  private scanAsked = false;
  /** The bars a move to this store's node brought from the last node's store, which every start keeps. */
  carried: ConsoleState["bars"] = {};

  constructor(private readonly store: ConsoleStore) {}

  /** Keeps the bars the last node's store showed, and where they came from, so a move to this node keeps the chart's history. */
  carry({ bars, barProvenance }: Pick<ConsoleState, "bars" | "barProvenance">): void {
    this.carried = bars;
    this.store.patch({ bars: { ...this.store.getSnapshot().bars, ...bars }, barProvenance });
  }

  /**
   * Seeds (market, timeframe)'s bars from the marks endpoint. Runs only for a signature-checking
   * client with node time; a market the stream has no bars for yet, such as one first seen
   * closed, is seeded from the fetch alone.
   */
  seed(marketId: MarketId, timeframe: TimeframeId): void {
    if (this.store.deps.client.signatures !== "checked" || this.unavailable || this.store.getSnapshot().now === 0) return;
    const key = `${marketId}:${timeframe}`;
    // A wait for another series is for a chart no longer shown: it is cancelled, and that series asks again if it is returned to.
    for (const other of [...this.waiting.keys()]) if (other !== key) this.cancelWait(other);
    if (this.seeded.has(key) || this.pending.has(key) || this.waiting.has(key)) return;
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    this.pending.add(key);
    void this.fetch(key, marketId, timeframe, attempt);
  }

  /** A series the user returns to, after its fetch failed, is tried again and says so again if it fails again. */
  retry(marketId: MarketId, timeframe: TimeframeId): void {
    const key = `${marketId}:${timeframe}`;
    if (!this.reported.delete(key)) return;
    this.seeded.delete(key);
    this.attempts.delete(key);
    this.waited.delete(key);
  }

  /** Asks for the archive scan once a node without the endpoint is read again, until it starts. */
  askScan(): void {
    if (this.unavailable) this.askHistoryScan();
  }

  /** Forgets the seeds and the scan's ask, so a restarted store (StrictMode re-runs the effect) works anew. */
  reset(): void {
    for (const key of [...this.waiting.keys()]) this.cancelWait(key);
    this.waited.clear();
    this.seeded.clear();
    this.pending.clear();
    this.attempts.clear();
    this.reported.clear();
    this.scanAsked = false;
  }

  /** Reads one timeframe's window of marks and folds it into that series; a 404 turns to the archive scan. */
  private async fetch(key: string, marketId: MarketId, timeframe: TimeframeId, attempt: number): Promise<void> {
    // A restart (StrictMode re-runs the effect) abandons this cycle's work, as the scan's stale check does.
    const epoch = this.store.scanEpoch;
    const stale = () => this.store.stopped || this.store.scanEpoch !== epoch;
    try {
      const toMs = this.store.getSnapshot().now;
      const pre = this.store.getSnapshot().bars[marketId]?.[timeframe] ?? null;
      const fetched = await fetchBarsHistory(this.store.deps.client, marketId, timeframe, toMs - windowSecondsFor(timeframe) * 1000, toMs);
      if (stale()) return;
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
      // A series that holds provider-seeded bars, as one carried from the last node may, says so whatever the new marks came from.
      const held = this.store.getSnapshot().barProvenance[marketId]?.[timeframe];
      const provenance = held === "seeded_from_provider" ? held : fetched.provenance;
      const barProvenance = provenance === null ? this.store.getSnapshot().barProvenance
        : { ...this.store.getSnapshot().barProvenance, [marketId]: { ...this.store.getSnapshot().barProvenance[marketId], [timeframe]: provenance } };
      this.seeded.add(key);
      this.store.patch({ bars, barProvenance });
      if (key === `${this.store.getSnapshot().selected}:${this.store.getSnapshot().timeframe}`) this.store.clearNotice("chart");
    } catch (error) {
      if (stale()) return;
      if (error instanceof EngineError && error.status === 404) {
        this.unavailable = true;
        this.askHistoryScan();
        return;
      }
      // A node still importing its earlier history is not a failure: wait as long as it names, then ask again.
      if (error instanceof EngineError && error.status === 503) {
        const snapshot = this.store.getSnapshot();
        // A series no longer shown waits for nothing; it asks again when it is returned to.
        if (key !== `${snapshot.selected}:${snapshot.timeframe}`) return;
        const waited = this.waited.get(key) ?? 0;
        const delay = Math.min(NOT_READY_MAX_MS, Math.max(NOT_READY_MIN_MS, error.retryAfterMs ?? NOT_READY_DEFAULT_MS));
        if (waited + delay <= NOT_READY_BUDGET_MS) {
          this.waited.set(key, waited + delay);
          this.attempts.delete(key);
          this.waiting.set(key, setTimeout(() => {
            this.waiting.delete(key);
            if (!this.store.stopped) this.seed(marketId, timeframe);
          }, delay));
          return;
        }
        this.giveUp(key);
        return;
      }
      // A node not verified yet says so in the banner, and the next trigger reads again; it does not count as an attempt.
      if (awaitsTrust(error)) return;
      // A transient failure retries on the next trigger; the last one reports once and stops.
      if (attempt >= SEED_ATTEMPTS) this.giveUp(key);
    } finally {
      // A stale request never clears the flag a newer cycle set for the same series.
      if (!stale()) this.pending.delete(key);
    }
  }

  private cancelWait(key: string): void {
    clearTimeout(this.waiting.get(key));
    this.waiting.delete(key);
  }

  /** Reports once that a series' history could not be had, and stops asking for it. */
  private giveUp(key: string): void {
    if (this.seeded.has(key) || this.reported.has(key)) return;
    this.reported.add(key);
    this.seeded.add(key);
    this.store.notify("chart", HISTORY_UNAVAILABLE);
  }

  /** Starts the archive-scan fallback; un-wired or not-yet-startable answers are asked again on the next read. */
  private askHistoryScan(): void {
    if (this.scanAsked) return;
    this.scanAsked = this.store.deps.historyScan ? this.store.deps.historyScan(this.store, this.store.getSnapshot().markets) : false;
  }
}
