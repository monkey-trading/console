/**
 * The Staking page's reads of the connected account's distribution history (monkey-trading/console#271):
 * on open, one page of each kind for the wallet; then what the stream adds, and older pages only on
 * "Load more". The node's history index trails its stream by the index writer's queue, and its
 * answers name no position in the log the index has reached, so an epoch that closed as the page
 * opened can be missing from the first pages and already past on the stream: the newest pages are
 * read again a tick after the first read lands, and then on the node read's pace for as long as the
 * page is open and its tab visible. A failed read is made again by itself, further apart each time,
 * with no button.
 * The page opens these reads only while the node is trusted, which a gap in the feed ends, so a
 * reopening reads afresh and nothing the gap carried stays missing.
 */

import { EngineError } from "../engine/client";
import type { HistoryPage } from "../engine/types";
import { Backoff } from "../monkey/live-reads";
import { NODE_READ_MS } from "../monkey/panel";
import type { ConsoleStore } from "../store/store";
import { addMessage, addNewest, addPage, emptyHistory, HISTORY_KINDS, limitingKinds, moreRemain, type DistributionHistory, type HistoryKind } from "./distribution-history";

export interface HistoryState {
  /** The account the history is for; null with no wallet. */
  account: string | null;
  data: DistributionHistory;
  status: "idle" | "reading" | "ready" | "failed";
  /** Whether an older page is being read. */
  more: boolean;
  /** Why the last read failed; null after one that landed. */
  error: string | null;
  /** Why the last read of the newest pages again failed; it stays due and is made again by itself, and what is held stands meanwhile. */
  recheckError: string | null;
}

/** Events per read: the node's page limit is 200, and an epoch is one event of each kind. */
export const HISTORY_PAGE = 50;
/** How often a failed first read, or a second read of the newest pages still due, is considered again; the backoff decides whether it is made. */
export const RETRY_TICK_MS = 5_000;

const IDLE: HistoryState = { account: null, data: emptyHistory(), status: "idle", more: false, error: null, recheckError: null };

/** The text of a failed read for the card. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : "The node did not answer.";
}

export class DistributionHistoryReads {
  private state: HistoryState = IDLE;
  private readonly listeners = new Set<() => void>();
  private readonly backoff = new Backoff();
  private open = false;
  /** Counts openings and account changes; a read begun before one never writes after it. */
  private cycle = 0;
  /** The cycle whose first read has landed, and the device time from which its newest pages are next read again. */
  private recheck: { cycle: number; after: number } | null = null;
  /** The cycle whose read of the newest pages again is in flight, so the timer does not start another beside it. */
  private rechecking: number | null = null;

  constructor(private readonly store: ConsoleStore) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): HistoryState => this.state;

  private set(partial: Partial<HistoryState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  /** Starts the reads for the connected wallet, and returns what stops them and forgets what they read. While `isHidden` says the tab is hidden, no failed read is made again. */
  start(isHidden: () => boolean): () => void {
    this.open = true;
    this.cycle += 1;
    this.store.monkeySession.history = this;
    this.walletChanged();
    const unsubscribe = this.store.deps.client.subscribe((message) => {
      const { account, data } = this.state;
      if (account === null) return;
      const next = addMessage(data, message, account);
      if (next !== data) this.set({ data: next });
    });
    const timer = setInterval(() => {
      if (isHidden()) return;
      if (this.state.status === "failed" && this.backoff.ready()) void this.first(this.cycle);
      else if (this.recheck?.cycle === this.cycle && Date.now() >= this.recheck.after && this.rechecking !== this.cycle && this.state.status === "ready" && this.backoff.ready()) void this.readNewest(this.cycle);
    }, RETRY_TICK_MS);
    return () => {
      this.open = false;
      this.cycle += 1;
      clearInterval(timer);
      unsubscribe();
      if (this.store.monkeySession.history === this) this.store.monkeySession.history = null;
      this.backoff.reset();
      this.set(IDLE);
    };
  }

  /** Reads the history again for the connected wallet when it is not the one held: another account's epochs are not this one's. */
  walletChanged(): void {
    const account = this.store.liveWallet?.address ?? null;
    if (account !== this.state.account || this.state.status === "idle") this.readAfresh(account);
  }

  /** Drops what is held and reads it again: the account's history changed under it, as the mock's reset changes it. */
  invalidate(): void {
    this.readAfresh(this.store.liveWallet?.address ?? null);
  }

  private readAfresh(account: string | null): void {
    this.cycle += 1;
    this.backoff.reset();
    this.set({ ...IDLE, account });
    if (this.open && account !== null) void this.first(this.cycle);
  }

  /**
   * One page of `kind`. A node that predates the operator's share (V47) refuses its kind as unknown
   * (400), which is read as a stream with nothing in it.
   */
  private async page(account: string, kind: HistoryKind, before: string | null): Promise<HistoryPage> {
    try {
      return await this.store.deps.client.history(account, { kind, limit: HISTORY_PAGE, ...(before === null ? {} : { before }) });
    } catch (error) {
      if (kind === "operator_share_allocated" && error instanceof EngineError && error.status === 400) return { events: [], next: null };
      throw error;
    }
  }

  private async first(cycle: number): Promise<void> {
    const { account } = this.state;
    if (account === null || !this.open) return;
    this.set({ status: "reading", error: null });
    try {
      const pages = await Promise.all(HISTORY_KINDS.map((kind) => this.page(account, kind, null)));
      if (cycle !== this.cycle) return;
      this.backoff.record(false);
      // A full tick after this read landed, whatever the timer's phase.
      this.recheck = { cycle, after: Date.now() + RETRY_TICK_MS };
      this.set({ status: "ready", data: HISTORY_KINDS.reduce((held, kind, i) => addPage(held, kind, pages[i] ?? { events: [], next: null }), this.state.data) });
    } catch (error) {
      if (cycle !== this.cycle) return;
      this.backoff.record(true);
      this.set({ status: "failed", error: describe(error) });
    }
  }

  /**
   * The newest page of each kind again, folded in where the first read's covers stand: what the index
   * had not taken then. The next is due on the node read's pace; a failure keeps this one due, says
   * why on the card, and waits out the backoff.
   */
  private async readNewest(cycle: number): Promise<void> {
    const { account } = this.state;
    if (account === null) return;
    this.rechecking = cycle;
    try {
      const pages = await Promise.all(HISTORY_KINDS.map((kind) => this.page(account, kind, null)));
      if (cycle !== this.cycle) return;
      this.recheck = { cycle, after: Date.now() + NODE_READ_MS };
      this.backoff.record(false);
      this.set({ recheckError: null, data: pages.reduce((held, page) => addNewest(held, page), this.state.data) });
    } catch (error) {
      if (cycle !== this.cycle) return;
      this.backoff.record(true);
      this.set({ recheckError: describe(error) });
    } finally {
      if (this.rechecking === cycle) this.rechecking = null;
    }
  }

  /** "Load more": one older page of each kind that limits what shows; a failure says so under the button, which tries again. */
  async loadMore(): Promise<void> {
    const { account, status, more, data } = this.state;
    if (account === null || status !== "ready" || more || !moreRemain(data)) return;
    const cycle = this.cycle;
    this.set({ more: true, error: null });
    try {
      const kinds = limitingKinds(data);
      const pages = await Promise.all(kinds.map((kind) => this.page(account, kind, data.cover[kind].next)));
      if (cycle !== this.cycle) return;
      this.set({ more: false, data: kinds.reduce((held, kind, i) => addPage(held, kind, pages[i] ?? { events: [], next: null }), this.state.data) });
    } catch (error) {
      if (cycle === this.cycle) this.set({ more: false, error: describe(error) });
    }
  }
}
