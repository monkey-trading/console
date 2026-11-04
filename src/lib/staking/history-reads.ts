/**
 * The Staking page's reads of the connected account's distribution history (monkey-trading/console#271):
 * on open, one page of each kind for the wallet; then what the stream adds, and older pages only on
 * "Load more". A failed first read is made again by itself, further apart each time, with no button.
 * The page opens these reads only while the node is trusted, which a gap in the feed ends, so a
 * reopening reads afresh and nothing the gap carried stays missing.
 */

import { EngineError } from "../engine/client";
import type { HistoryPage } from "../engine/types";
import { Backoff } from "../monkey/live-reads";
import type { ConsoleStore } from "../store/store";
import { addMessage, addPage, emptyHistory, HISTORY_KINDS, moreRemain, type DistributionHistory, type HistoryKind } from "./distribution-history";

export interface HistoryState {
  /** The account the history is for; null with no wallet. */
  account: string | null;
  data: DistributionHistory;
  status: "idle" | "reading" | "ready" | "failed";
  /** Whether an older page is being read. */
  more: boolean;
  /** Why the last read failed; null after one that landed. */
  error: string | null;
}

/** Events per read: the node's page limit is 200, and an epoch is one event of each kind. */
export const HISTORY_PAGE = 50;
/** How often a failed first read is considered again; the backoff decides whether it is due. */
export const RETRY_TICK_MS = 5_000;

const IDLE: HistoryState = { account: null, data: emptyHistory(), status: "idle", more: false, error: null };

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
    this.walletChanged();
    const unsubscribe = this.store.deps.client.subscribe((message) => {
      const { account, data } = this.state;
      if (account === null) return;
      const next = addMessage(data, message, account);
      if (next !== data) this.set({ data: next });
    });
    const timer = setInterval(() => {
      if (!isHidden() && this.state.status === "failed" && this.backoff.ready()) void this.first(this.cycle);
    }, RETRY_TICK_MS);
    return () => {
      this.open = false;
      this.cycle += 1;
      clearInterval(timer);
      unsubscribe();
      this.backoff.reset();
      this.set(IDLE);
    };
  }

  /** Reads the history again for the connected wallet when it is not the one held: another account's epochs are not this one's. */
  walletChanged(): void {
    const account = this.store.liveWallet?.address ?? null;
    if (account === this.state.account && this.state.status !== "idle") return;
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
      this.set({ status: "ready", data: HISTORY_KINDS.reduce((held, kind, i) => addPage(held, kind, pages[i] ?? { events: [], next: null }), this.state.data) });
    } catch (error) {
      if (cycle !== this.cycle) return;
      this.backoff.record(true);
      this.set({ status: "failed", error: describe(error) });
    }
  }

  /** "Load more": one older page of each kind with more below it; a failure says so under the button, which tries again. */
  async loadMore(): Promise<void> {
    const { account, status, more, data } = this.state;
    if (account === null || status !== "ready" || more || !moreRemain(data)) return;
    const cycle = this.cycle;
    this.set({ more: true, error: null });
    try {
      const kinds = HISTORY_KINDS.filter((kind) => !data.cover[kind].done);
      const pages = await Promise.all(kinds.map((kind) => this.page(account, kind, data.cover[kind].next)));
      if (cycle !== this.cycle) return;
      this.set({ more: false, data: kinds.reduce((held, kind, i) => addPage(held, kind, pages[i] ?? { events: [], next: null }), this.state.data) });
    } catch (error) {
      if (cycle === this.cycle) this.set({ more: false, error: describe(error) });
    }
  }
}
