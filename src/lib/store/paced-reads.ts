/**
 * How a store follows a node across the network without reading it on every tick: markets and house
 * are read at most once per `READ_INTERVAL_MS` however fast ticks arrive, and between reads the
 * marks come from the stream's `prices` commands (`StreamMarks`), shown at most once per
 * `MARK_INTERVAL_MS` since every patch re-renders the page. Both waits are timers `stop` cancels.
 */

import type { MarketView, StreamMessage } from "../engine/types";
import type { MarketModel } from "../models";
import { tickBars } from "./bars-tick";
import type { ConsoleStore } from "./store";
import { StreamMarks } from "./stream-marks";
import { Throttle } from "./throttle";

/** The most often a tick prompts a read of markets and house. */
export const READ_INTERVAL_MS = 1_000;
/** The most often streamed marks reach the screen. */
export const MARK_INTERVAL_MS = 200;

export class PacedReads {
  private readonly marks = new StreamMarks();
  private readonly reads: Throttle;
  private readonly shows = new Throttle(MARK_INTERVAL_MS, () => this.show());
  /** Whether a tick that waits for the next read carried an account event. */
  private accountChanged = false;

  constructor(private readonly store: ConsoleStore, refresh: (accountChanged: boolean) => void) {
    this.reads = new Throttle(READ_INTERVAL_MS, () => {
      const changed = this.accountChanged;
      this.accountChanged = false;
      refresh(changed);
    });
  }

  /** A tick arrived: reads now if none ran within the interval, else once when it ends. */
  readOnTick(accountChanged: boolean): void {
    this.accountChanged ||= accountChanged;
    this.reads.request();
  }

  /** Folds a stream message into the marks and asks to show what it left. */
  observe(message: StreamMessage): void {
    if (this.marks.observe(message)) this.shows.request();
  }

  /** Follows a read's markets, and keeps the stream's marks that are newer than it. */
  reconcile(views: readonly MarketView[], read: MarketModel[]): MarketModel[] {
    this.marks.configure(views);
    return this.marks.reconcile(read, this.store.deps.client.headSeq);
  }

  /** Cancels both timers and drops what they held and the books, so nothing fires once the store stops. */
  stop(): void {
    this.reads.cancel();
    this.shows.cancel();
    this.accountChanged = false;
    this.marks.reset();
  }

  private show(): void {
    const marks = this.marks.take();
    const snapshot = this.store.getSnapshot();
    const shown = snapshot.markets.flatMap((m) => {
      const streamed = marks.get(m.id);
      return streamed !== undefined && m.open ? [{ ...m, mark: streamed.mark }] : [];
    });
    if (this.store.stopped || shown.length === 0) return;
    const now = Math.max(snapshot.now, ...[...marks.values()].map((m) => m.ts));
    this.store.patch({ markets: snapshot.markets.map((m) => shown.find((s) => s.id === m.id) ?? m), now, bars: tickBars(this.store, shown, now) });
  }
}
