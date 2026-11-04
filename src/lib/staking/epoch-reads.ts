/**
 * The Staking page's reads of the closed distribution epochs (monkey-trading/console#279): the node's
 * signed `GET /v1/monkey/distributions`, newest first, with older pages on "Load more". The newest page
 * is read on open, again on the node read's pace while the tab is visible, and as soon as the stream
 * carries a distribution allocation, which only an epoch's close makes; a failed read is made again by
 * itself, further apart each time, with no button. The page opens these reads only while the node is
 * trusted, so a reopening reads afresh.
 */

import type { DistributionEpochsPage, EpochClose } from "../engine/staking-reads";
import { Backoff } from "../monkey/live-reads";
import { NODE_READ_MS } from "../monkey/panel";
import type { ConsoleStore } from "../store/store";
import { RETRY_TICK_MS } from "./history-reads";

/** Epochs per read: the node allows 1 to 200. */
export const EPOCH_PAGE = 20;
/** Most epochs held; older ones are not read past it. */
export const MAX_HELD_EPOCHS = 2_000;

/** Where the node's record of closes begins, and whether it has dropped older ones for room. */
export type EpochCover = Pick<DistributionEpochsPage, "begins_ms" | "from_genesis" | "truncated" | "retained_from_epoch">;

export interface EpochsState {
  status: "idle" | "reading" | "ready" | "failed" | "unavailable";
  /** Newest first, one per epoch. */
  epochs: readonly EpochClose[];
  /** The `before` for the next older page; null once none is held. */
  next: number | null;
  cover: EpochCover | null;
  /** Whether an older page is being read. */
  more: boolean;
  /** Why the last read of the newest page failed, and the last Load more; null after one that landed. */
  error: string | null;
  moreError: string | null;
}

const IDLE: EpochsState = { status: "idle", epochs: [], next: null, cover: null, more: false, error: null, moreError: null };

/**
 * `held` with `page` folded in. A newest page adds the epochs that closed since and replaces the ones
 * it holds again, keeping the older pages' cursor; one that does not reach what is held, past a gap of
 * more than a page, starts the list again from itself. An older page adds below and moves the cursor.
 * At most `MAX_HELD_EPOCHS` are kept, and none is read past them.
 */
export function foldEpochs(held: Pick<EpochsState, "epochs" | "next">, page: DistributionEpochsPage, older: boolean): Pick<EpochsState, "epochs" | "next"> {
  const newestHeld = held.epochs[0];
  if (!older && newestHeld !== undefined && page.next !== null && !page.epochs.some((close) => close.epoch <= newestHeld.epoch)) {
    return { epochs: page.epochs.slice(0, MAX_HELD_EPOCHS), next: page.next };
  }
  const byEpoch = new Map<number, EpochClose>();
  for (const close of held.epochs) byEpoch.set(close.epoch, close);
  for (const close of page.epochs) byEpoch.set(close.epoch, close);
  const epochs = [...byEpoch.values()].sort((a, b) => b.epoch - a.epoch).slice(0, MAX_HELD_EPOCHS);
  const next = older || newestHeld === undefined ? page.next : held.next;
  return { epochs, next: epochs.length >= MAX_HELD_EPOCHS ? null : next };
}

/** The text of a failed read for the card. */
const describe = (error: unknown): string => (error instanceof Error ? error.message : "The node did not answer.");

export class EpochReads {
  private state: EpochsState = IDLE;
  private readonly listeners = new Set<() => void>();
  private readonly backoff = new Backoff();
  /** Counts openings; a read begun in an earlier one never writes into a later one. */
  private cycle = 0;
  /** When the newest page is next read again, by the device's clock. */
  private dueAt = 0;
  private reading = false;

  constructor(private readonly store: ConsoleStore) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): EpochsState => this.state;

  private set(partial: Partial<EpochsState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  /** Starts the reads, and returns what stops them and forgets what they read. While `isHidden` says the tab is hidden nothing is read again. */
  start(isHidden: () => boolean): () => void {
    this.cycle += 1;
    this.backoff.reset();
    this.set({ ...IDLE, status: "reading" });
    void this.readNewest(this.cycle);
    const unsubscribe = this.store.deps.client.subscribe((message) => {
      // An allocation is made only by an epoch's close, so a new epoch is on the node now.
      if (message.events.some((event) => event.type === "distribution_allocated" || event.type === "operator_share_allocated")) this.dueAt = 0;
    });
    const timer = setInterval(() => {
      if (isHidden() || this.reading || this.state.status === "unavailable" || !this.backoff.ready()) return;
      if (this.state.status === "failed" || Date.now() >= this.dueAt) void this.readNewest(this.cycle);
    }, RETRY_TICK_MS);
    return () => {
      this.cycle += 1;
      clearInterval(timer);
      unsubscribe();
      this.set(IDLE);
    };
  }

  private async readNewest(cycle: number): Promise<void> {
    this.reading = true;
    try {
      const page = await this.store.deps.client.stats.distributionEpochs({ limit: EPOCH_PAGE });
      if (cycle !== this.cycle) return;
      this.backoff.record(false);
      this.dueAt = Date.now() + NODE_READ_MS;
      this.set({ status: "ready", error: null, cover: page, ...foldEpochs(this.state, page, false) });
    } catch (error) {
      if (cycle !== this.cycle) return;
      const unavailable = typeof error === "object" && error !== null && "status" in error && error.status === 404;
      this.backoff.record(!unavailable);
      // What is held stands beside the reason; a node without the route is calmly unavailable.
      this.set(unavailable ? { status: "unavailable", error: null } : { status: this.state.epochs.length > 0 ? "ready" : "failed", error: describe(error) });
    } finally {
      if (cycle === this.cycle) this.reading = false;
    }
  }

  /**
   * "Load more": the next older page; a failure says so under the button, which tries again. A page
   * that lands after a read of the newest page started the list again, past a gap, belongs to the
   * list that was replaced, so it is dropped: the cursor it was asked from is no longer the held one.
   */
  async loadMore(): Promise<void> {
    const { status, more, next } = this.state;
    if (status !== "ready" || more || next === null) return;
    const cycle = this.cycle;
    this.set({ more: true, moreError: null });
    try {
      const page = await this.store.deps.client.stats.distributionEpochs({ before: next, limit: EPOCH_PAGE });
      if (cycle !== this.cycle) return;
      if (this.state.next !== next) this.set({ more: false });
      else this.set({ more: false, cover: page, ...foldEpochs(this.state, page, true) });
    } catch (error) {
      // A failure for a list that has since been replaced says nothing of the one held now.
      if (cycle === this.cycle) this.set(this.state.next === next ? { more: false, moreError: describe(error) } : { more: false });
    }
  }
}
