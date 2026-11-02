/**
 * The P&L tab's reads. Nothing is read until the tab opens: then one page of each kind of event
 * the ledger needs and the emission schedule, once. Older pages come only on "Load more", and
 * stream messages add new rows to what is held, and a bounded reach reads older allocations as far
 * as the rows need. Pages are kept for the session, bounded.
 */

import type { EmissionSchedule } from "../engine/emission-schedule";
import type { HistoryPage, StreamMessage } from "../engine/types";
import {
  addMessage, addPage, allocationsShort, atBound, closedBefore, emptyLedger, LEDGER_KINDS, ROW_KINDS,
  type LedgerData, type LedgerKind,
} from "../ledger";
import type { ConsoleStore } from "./store";

export interface LedgerState {
  data: LedgerData;
  schedule: EmissionSchedule | null;
  /** `unavailable` is a node that reports no schedule (a 404); `failed` one that did not answer. */
  scheduleStatus: "idle" | "ready" | "unavailable" | "failed";
  status: "idle" | "reading" | "ready" | "failed";
  /** Whether a read of older pages runs. */
  more: boolean;
  error: string | null;
}

export function emptyLedgerState(): LedgerState {
  return { data: emptyLedger(), schedule: null, scheduleStatus: "idle", status: "idle", more: false, error: null };
}

/** Events per read: the engine caps a page at 200. Fills outnumber the rest, and about half realise nothing. */
const PAGE: Record<LedgerKind, number> = { fill: 100, corporate_cash_in_lieu: 50, emission_allocated: 100 };
/** Reads one "Load more" or the first load may add to reach the oldest row's allocation. */
const EXTRA_ALLOCATION_PAGES = 5;

export class LedgerReads {
  /** The account the held data was read for. */
  private owner: string | null = null;
  /** The account whose tab is open now. */
  private shown: string | null = null;
  private epoch = 0;
  /** The epoch of the schedule read in flight, so a reset's replacement is not skipped for the read it dropped. */
  private scheduleEpoch: number | null = null;
  private reaching: Promise<void> = Promise.resolve();
  /** Allocation pages the current first load or "Load more" may still read, shared by the reaches it and the schedule's arrival make. */
  private budget = 0;

  constructor(private readonly store: ConsoleStore) {}

  private get state(): LedgerState {
    return this.store.getSnapshot().ledger;
  }

  private set(partial: Partial<LedgerState>): void {
    this.store.patch({ ledger: { ...this.state, ...partial } });
  }

  /** Whether a read begun for `account` at `epoch` still answers the question: the same account, not reset since. */
  private live(account: string, epoch: number): boolean {
    return this.epoch === epoch && this.store.getSnapshot().wallet?.address === account;
  }

  /** The tab opened for `account`: reads what is not held yet. Returns what closes the tab. */
  open(account: string): () => void {
    this.shown = account;
    if (this.owner !== account) this.reset();
    this.owner = account;
    if (this.state.status === "idle" || this.state.status === "failed") void this.first(account);
    if (this.state.scheduleStatus !== "ready" && this.scheduleEpoch !== this.epoch) void this.readSchedule(account);
    // A reach the tab's closing cut short resumes here.
    if (this.state.status === "ready") {
      this.budget = EXTRA_ALLOCATION_PAGES;
      void this.reachAllocations(account, this.epoch);
    }
    return () => {
      if (this.shown === account) this.shown = null;
    };
  }

  /** Drops what is held, and the answers of reads in flight. */
  reset(): void {
    this.epoch += 1;
    this.owner = null;
    this.store.patch({ ledger: emptyLedgerState() });
  }

  /** The wallet changed: held rows belong to another account. */
  walletChanged(address: string | undefined): void {
    if (address !== this.owner && this.state.status !== "idle") this.reset();
  }

  /** The stream resumed at the live end after a gap, so held rows may miss events: read again if the tab is open. */
  invalidate(): void {
    if (this.state.status === "idle") return;
    const account = this.shown;
    this.reset();
    if (account !== null) this.open(account);
  }

  /** Folds a stream message into what is held, once the tab has read at all. */
  ingest(message: StreamMessage): void {
    const wallet = this.store.getSnapshot().wallet;
    if (this.state.status === "idle" || !wallet) return;
    const data = addMessage(this.state.data, message, wallet.address);
    if (data !== this.state.data) this.set({ data });
  }

  private page(account: string, kind: LedgerKind, before: string | null): Promise<HistoryPage> {
    return this.store.deps.client.history(account, { kind, limit: PAGE[kind], ...(before === null ? {} : { before }) });
  }

  private async first(account: string): Promise<void> {
    const epoch = this.epoch;
    this.budget = EXTRA_ALLOCATION_PAGES;
    this.set({ status: "reading", error: null });
    try {
      const pages = await Promise.all(LEDGER_KINDS.map((kind) => this.page(account, kind, null)));
      if (!this.live(account, epoch)) return;
      const data = LEDGER_KINDS.reduce((held, kind, i) => addPage(held, kind, pages[i] ?? { events: [], next: null }), this.state.data);
      this.set({ data, status: "ready" });
    } catch (error) {
      if (this.live(account, epoch)) this.set({ status: "failed", error: describe(error) });
      return;
    }
    await this.reachAllocations(account, epoch);
  }

  /** Reads the schedule once per open; a node without one leaves the MONKEY column at "—". */
  private async readSchedule(account: string): Promise<void> {
    const epoch = this.epoch;
    this.scheduleEpoch = epoch;
    try {
      const schedule = await this.store.deps.client.emissionSchedule();
      if (this.scheduleEpoch === epoch) this.scheduleEpoch = null;
      if (!this.live(account, epoch)) return;
      if (schedule === null) this.set({ scheduleStatus: "unavailable", schedule: null });
      else this.set({ scheduleStatus: "ready", schedule, data: closedBefore(this.state.data, schedule) });
    } catch {
      if (this.scheduleEpoch === epoch) this.scheduleEpoch = null;
      // The rows show without MONKEY; the next open of the tab asks again. Nothing is toasted, so a node that is down is not announced twice.
      if (this.live(account, epoch)) this.set({ scheduleStatus: "failed" });
      return;
    }
    await this.reachAllocations(account, epoch);
  }

  /** "Load more": one older page of each stream with more below it. */
  async loadMore(): Promise<void> {
    const account = this.owner;
    const { status, more, data } = this.state;
    if (account === null || status !== "ready" || more || atBound(data)) return;
    const epoch = this.epoch;
    this.budget = EXTRA_ALLOCATION_PAGES;
    this.set({ more: true, error: null });
    try {
      // Allocations are read only as far as the rows need them, by the reach below.
      const kinds = ROW_KINDS.filter((kind) => !data.cover[kind].done && data.cover[kind].next !== null);
      const pages = await Promise.all(kinds.map((kind) => this.page(account, kind, data.cover[kind].next)));
      if (!this.live(account, epoch)) return;
      this.set({ data: kinds.reduce((held, kind, i) => addPage(held, kind, pages[i] ?? { events: [], next: null }), this.state.data), more: false });
    } catch (error) {
      if (this.live(account, epoch)) this.set({ more: false, error: describe(error) });
      return;
    }
    await this.reachAllocations(account, epoch);
  }

  /**
   * Reads older allocations until they reach the oldest row's period, within a few pages. Runs
   * after any reach already running, which has by then read what this one would.
   */
  private reachAllocations(account: string, epoch: number): Promise<void> {
    const run = this.reaching.then(() => this.extendAllocations(account, epoch));
    this.reaching = run;
    return run;
  }

  private async extendAllocations(account: string, epoch: number): Promise<void> {
    while (this.budget > 0) {
      const { data, schedule, status } = this.state;
      const cover = data.cover.emission_allocated;
      // Reads run only while the tab is open; reopening it resumes them.
      if (this.shown !== account || !this.live(account, epoch) || status !== "ready" || cover.next === null || !allocationsShort(data, schedule)) return;
      this.budget -= 1;
      try {
        const page = await this.page(account, "emission_allocated", cover.next);
        if (!this.live(account, epoch)) return;
        this.set({ data: addPage(this.state.data, "emission_allocated", page), error: null });
      } catch (error) {
        if (this.live(account, epoch)) this.set({ error: describe(error) });
        return;
      }
    }
  }
}

/** The text of a failed read for the tab. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : "The node did not answer.";
}
