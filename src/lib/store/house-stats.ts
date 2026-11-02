/**
 * The House page's dashboard reads. A panel follows a feed (one signed read, repeated on its own
 * interval) and the feed runs only while the House page is open and a panel follows it, so nothing
 * here reads the node once the page is left. The node signs every answer and its scan figures move
 * once per `api.stats_interval`, so a feed is never read more than once in `MIN_EVERY_MS`, and a
 * feed nothing follows is dropped once more than `MAX_IDLE` of them are kept.
 */

import { EngineError } from "../engine/client";
import type { ConsoleStore } from "./store";

/** The shortest wait between two reads of one feed, whatever a panel asks for. */
export const MIN_EVERY_MS = 5_000;
/** How long a feed whose route the node does not serve waits before asking again. */
const UNAVAILABLE_RETRY_MS = 300_000;
/** How long a feed the node has no scan for yet waits before asking again. */
const WAITING_RETRY_MS = 10_000;
/** The longest a failing feed backs off to. */
const MAX_BACKOFF_MS = 120_000;
/** The unfollowed feeds kept so that switching back to one shows it at once. */
const MAX_IDLE = 6;

export type FeedStatus = "loading" | "ready" | "waiting" | "unavailable" | "failed";

/** What a feed holds: its latest data (kept through a failed read, marked `stale`) and why the last read did not land. */
export interface FeedState<T> {
  status: FeedStatus;
  data: T | null;
  /** True when `data` is from before a read that failed. */
  stale: boolean;
  error: string | null;
}

/** A feed's definition: one signed read, which may extend what the feed already holds. */
export interface FeedSpec<T> {
  key: string;
  everyMs: number;
  /** `alive` turns false once nothing follows the feed or the page has closed, so a read of several requests stops asking. */
  read(previous: T | null, alive: () => boolean): Promise<T>;
}

/** What a feed nobody has read yet holds. */
export const LOADING: FeedState<never> = { status: "loading", data: null, stale: false, error: null };

interface Entry {
  spec: FeedSpec<unknown>;
  refs: number;
  state: FeedState<unknown>;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  failures: number;
  /** When the last read ended; the next waits one pace from it. */
  doneAt: number;
  /** When the next read starts after a refusal or failure, while that time is ahead. */
  notBefore: number;
}

export class HouseStats {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private open = false;
  private visible = true;

  constructor(private readonly store: ConsoleStore, private readonly nowMs: () => number = Date.now) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** The feed's state; a feed nobody followed reads as loading. */
  state<T>(key: string): FeedState<T> {
    // The entry's data was produced by the spec that was followed under this key, whose type the caller names.
    return (this.entries.get(key)?.state ?? LOADING) as FeedState<T>;
  }

  /** Starts the feeds panels follow when the House page opens, and stops every timer when it closes. */
  setOpen(open: boolean): void {
    this.open = open;
    this.sync();
  }

  /** Pauses every feed while the tab is hidden and resumes them, at their own pace, when it shows again. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.sync();
  }

  private get active(): boolean {
    return this.open && this.visible;
  }

  private sync(): void {
    for (const entry of this.entries.values()) {
      if (this.active) this.schedule(entry);
      else this.stop(entry);
    }
  }

  /** Follows a feed until the returned release runs; following again with another interval changes the pace. */
  follow<T>(spec: FeedSpec<T>): () => void {
    let entry = this.entries.get(spec.key);
    if (entry === undefined) {
      entry = { spec: spec as FeedSpec<unknown>, refs: 0, state: LOADING, timer: null, running: false, failures: 0, doneAt: Number.NEGATIVE_INFINITY, notBefore: 0 };
      this.entries.set(spec.key, entry);
      this.prune();
    }
    entry.spec = spec as FeedSpec<unknown>;
    entry.refs += 1;
    this.schedule(entry);
    const followed = entry;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      followed.refs -= 1;
      if (followed.refs === 0) this.stop(followed);
    };
  }

  private stop(entry: Entry): void {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
  }

  /**
   * Waits out the wait a refusal or failure chose while one is running, and otherwise what is left of
   * the feed's current pace since its last read, then reads. Following again, a change of pace and a tab
   * that shows again all come through here, so none of them cuts a backoff short.
   */
  private schedule(entry: Entry): void {
    if (!this.active || entry.refs === 0 || entry.running) return;
    this.stop(entry);
    const every = Math.max(entry.spec.everyMs, MIN_EVERY_MS);
    const now = this.nowMs();
    // A refusal or failure fixes the next read at its own time, which the pace never shortens or extends.
    const wait = entry.notBefore > now ? entry.notBefore - now : Math.max(0, entry.doneAt + every - now);
    entry.timer = setTimeout(() => void this.read(entry), wait);
  }

  private async read(entry: Entry): Promise<void> {
    entry.timer = null;
    if (!this.active || entry.refs === 0 || entry.running || this.store.stopped) return;
    entry.running = true;
    let backoffMs = 0;
    try {
      const data = await entry.spec.read(entry.state.data, () => this.active && entry.refs > 0 && !this.store.stopped);
      entry.failures = 0;
      entry.notBefore = 0;
      this.set(entry, { status: "ready", data, stale: false, error: null });
    } catch (error) {
      this.store.noteAccess(error);
      entry.failures += 1;
      const had = entry.state.data;
      if (error instanceof EngineError && error.status === 404) {
        backoffMs = UNAVAILABLE_RETRY_MS;
        this.set(entry, { status: "unavailable", data: had, stale: had !== null, error: null });
      } else if (error instanceof EngineError && error.status === 503) {
        backoffMs = WAITING_RETRY_MS;
        this.set(entry, { status: "waiting", data: had, stale: had !== null, error: null });
      } else {
        backoffMs = Math.min(MAX_BACKOFF_MS, Math.max(entry.spec.everyMs, MIN_EVERY_MS) * 2 ** Math.min(entry.failures, 6));
        const message = error instanceof Error ? error.message : "The node did not answer.";
        this.set(entry, { status: had === null ? "failed" : "ready", data: had, stale: had !== null, error: message });
      }
    } finally {
      entry.running = false;
      entry.doneAt = this.nowMs();
      if (backoffMs > 0) entry.notBefore = entry.doneAt + backoffMs;
      this.schedule(entry);
    }
  }

  private set(entry: Entry, state: FeedState<unknown>): void {
    entry.state = state;
    for (const listener of this.listeners) listener();
  }

  /** Drops the oldest unfollowed feeds beyond `MAX_IDLE`, so what is held stays bounded. */
  private prune(): void {
    const idle = [...this.entries.entries()].filter(([, e]) => e.refs === 0);
    for (const [key] of idle.slice(0, Math.max(0, idle.length - MAX_IDLE))) this.entries.delete(key);
  }
}
