/** The console's store: reads the node, follows its stream, and notifies the screens. */

import type { TimeframeId } from "../bars";
import { maySign } from "../engine/attestation";
import type { ClientEvent } from "../engine/client";
import type { SessionKeySigner } from "../engine/session-key";
import type { MarketId, Reject, StreamMessage } from "../engine/types";
import type { Wallet } from "../engine/wallet";
import { MonkeySession } from "../monkey/wallet-queue";
import { decodeAccount, decodeHouse, decodeMarket } from "../models";
import { loadAccount } from "./account";
import { tickBars } from "./bars-tick";
import { BarsSeed } from "./bars-seed";
import { FEED_LIMIT, feedFrom, isMine } from "./feed";
import { LedgerReads } from "./ledger";
import { initialState, seedAllBars, type ConsoleState, type ToastMessage } from "./state";
import { readHousePanelSoon } from "./house";
import { HouseStats } from "./house-stats";
import { PacedReads } from "./paced-reads";
import { loginOnCredit, loginWhenLive } from "./session";
import { noteAccess } from "./signing";
import type { StoreDeps } from "./store-deps";

export class ConsoleStore {
  readonly deps: StoreDeps;
  /** The connected wallet, which holds a signer and so is not part of the snapshot. */
  liveWallet: Wallet | null = null;
  /** The ephemeral in-browser key trading signs with and its registration's expiry by the node's clock (console#68); the private key never enters the snapshot. */
  sessionKey: SessionKeySigner | null = null;
  sessionKeyExpiresAt = 0;
  /** Why the last login the node answered was refused, or null: a refused registration sends orders and cancels through the wallet instead. */
  sessionLoginRefusal: Reject | null = null;
  /** The login in flight, so concurrent callers share one attempt and one wallet prompt. */
  sessionLogin: Promise<boolean> | null = null;
  /** The previous disconnect's revocation and release, awaited before the next connect adopts. */
  walletCleanup: Promise<void> | null = null;
  /** Bookkeeping for the background vault reads: `paidCheck`/`emissionsCheck` name the wallet each runs for, `lastEmissionsReadError` dedupes its repeated failures. */
  paidCheck: Wallet | null = null;
  emissionsCheck: Wallet | null = null;
  lastEmissionsReadError: string | null = null;
  readonly monkeySession = new MonkeySession(); // the MONKEY page's wallet queue and, while it is on screen, its store
  private snapshot: ConsoleState;
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  /** The account whose activity shows before any wallet is connected. */
  private viewer: string | undefined;
  private inflight: Promise<void> | null = null;
  /** A refresh asked for while one ran: its answer may predate the change, so it reads again. */
  private rerun: { accountChanged: boolean } | null = null;
  private unsubscribe: (() => void) | null = null;
  private unwatch: (() => void) | null = null;
  /** Paces the reads and shows the stream's marks for a node across the network; null for the mock, which runs in this page and is read on every tick. */
  private readonly pacing: PacedReads | null;
  /** Seeds the chart's bars from the marks endpoint once per market and timeframe. */
  readonly barsSeed = new BarsSeed(this);
  /** The P&L tab's reads, and the House page's dashboard feeds: each runs only while its page is open. */
  readonly ledger = new LedgerReads(this); readonly houseStats = new HouseStats(this);
  /** When each market's bar bucket was last ticked from the node's mark; a merge tells a stale candle from a fresh one. Not part of the snapshot. */
  readonly barTicks: Record<number, Partial<Record<TimeframeId, Map<number, number>>>> = {};
  /** Stand-down flags for pending history work, bumped on each start; not part of the snapshot. */
  stopped = false;
  scanEpoch = 0;
  /** Whether trust in the node was lost (a failed check or a wrong clock) and not yet regained. */
  private trustLost = false;
  /** The last read failure shown, so a failure that repeats on every tick is shown once. */
  private lastReadError: string | null = null;
  /** Whether the House page is on screen, the only time its reads run. */
  housePanelOpen = false;
  houseRead: Promise<void> | null = null;
  /** The house panel's queue walk in flight, guarded apart from the log reads. Not part of the snapshot. */
  queueRead: Promise<void> | null = null;
  /** The last log read failure shown, deduplicated like the main read's. Not part of the snapshot. */
  lastHouseReadError: string | null = null;
  /** The last queue walk failure shown, deduplicated like the main read's. Not part of the snapshot. */
  lastQueueReadError: string | null = null;
  /** The last account read failure shown, deduplicated like the main read's. Not part of the snapshot. */
  lastAccountError: string | null = null;
  constructor(deps: StoreDeps) {
    this.deps = deps;
    this.viewer = deps.initial.viewer;
    this.pacing = deps.client.signatures === "none" ? null : new PacedReads(this, (accountChanged) => void this.refresh(accountChanged));
    const state = initialState(deps.initial.markets, deps.initial.house, deps.initial.startMs, deps.history, deps.client.signatures, deps.initial.housePanel);
    const session = deps.initial.session;
    this.snapshot = {
      ...state,
      feed: feedFrom(deps.initial.recent ?? [], state.markets, this.viewer, () => this.id()),
      ...(session
        ? { wallet: session.wallet, account: session.account ? decodeAccount(session.account) : null, eligibility: session.eligibility, queue: session.queue, accountQueueRead: true, history: session.history }
        : {}),
    };
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ConsoleState => this.snapshot;

  patch(partial: Partial<ConsoleState>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }

  id = (): number => this.nextId++;

  toast(tone: ToastMessage["tone"], text: string): void {
    this.patch({ toasts: [...this.snapshot.toasts.slice(-3), { id: this.id(), tone, text }] });
  }

  clearToasts(): void {
    this.patch({ toasts: [] });
  }

  dismissToast(id: number): void {
    this.patch({ toasts: this.snapshot.toasts.filter((t) => t.id !== id) });
  }

  select(id: MarketId): void {
    this.patch({ selected: id });
    this.barsSeed.seed(id, this.snapshot.timeframe);
  }

  /** Sets the connected wallet (or none) and drops activity lines that belong to another account. */
  setWallet(wallet: { address: string; label: string; readOnly?: boolean } | null): void {
    this.ledger.walletChanged(wallet?.address);
    this.viewer = undefined; // once a wallet has been connected or left, the starting viewer no longer applies
    this.lastEmissionsReadError = null; // a new wallet's vault reads start fresh: no stale latch
    this.lastAccountError = null; // its account reads start fresh too: the same failure under a new wallet is reported
    const mine = wallet?.address.toLowerCase();
    this.patch({ wallet, accountQueueRead: false, feed: this.snapshot.feed.filter((line) => line.account === undefined || line.account === mine) });
  }

  setPaused(paused: boolean): void {
    this.patch({ paused });
  }

  setTimeframe(timeframe: TimeframeId): void {
    this.patch({ timeframe });
    this.barsSeed.seed(this.snapshot.selected, timeframe);
  }

  /** Marks the caller as refused when `error` is an access refusal; true if it was. */
  noteAccess(error: unknown): boolean {
    return noteAccess(this, error);
  }

  /** Starts following the node at `nowMs`: checks its attestation and access, redraws the charts, and subscribes to the stream. */
  start(nowMs: number): () => void {
    // A restart (React StrictMode re-runs the effect) cancels the previous cycle's pending
    // history work and scans anew: its results were discarded when the cycle stopped.
    this.stopped = false;
    this.scanEpoch += 1;
    this.pacing?.stop(); // a restart (StrictMode) begins with no wait or held read from the cycle before
    this.barsSeed.reset();
    this.deps.drive?.(nowMs);
    this.patch({ now: nowMs, bars: seedAllBars(this.snapshot.markets, nowMs, this.deps.history) });
    this.unwatch = this.deps.client.watch((event) => this.onClientEvent(event));
    this.unsubscribe = this.deps.client.subscribe((message) => this.onMessage(message));
    void this.checkNode();
    return () => {
      this.stopped = true;
      this.pacing?.stop();
      this.unsubscribe?.();
      this.unwatch?.();
      this.unsubscribe = this.unwatch = null;
    };
  }

  /** Advances a node that runs in this page. */
  tick(nowMs: number): void {
    this.deps.drive?.(nowMs);
  }

  /** Applies a change the client reports: the node's attestation, its feed, or a dropped stream. */
  private onClientEvent(event: ClientEvent): void {
    if (event.type === "feed") {
      // A feed back from a failure resumes at the live end, so what it missed is read again. The
      // first frame of the first connection does the same: the reads made while it was connecting
      // may predate an event the stream, which starts at the live end, will never carry.
      const was = this.snapshot.stream;
      const read = event.status === "live" && (was === "stale" || was === "connecting");
      // The frame's signed time moves the node clock first, so a read it prompts plots marks at node time, not the pre-outage time.
      this.patch({ stream: event.status, ...(event.time !== undefined && event.time > this.snapshot.now ? { now: event.time } : {}) });
      if (read) {
        // A connect that found the feed still starting runs the login now, when signing is possible.
        loginWhenLive(this);
        this.ledger.invalidate(); // the stream resumes at the live end: events from the gap are read again
        void this.refresh(true);
      }
    } else if (event.type === "problem") this.toast("error", event.reason);
    // Data read under the old enclave is read again once the new one is trusted; a check that ends
    // at the same address changes nothing, so a read that keeps failing is not repeated by it.
    else if (event.type === "enclave") {
      this.trustLost = false; // this read is the one trust regained would ask for
      void this.refresh(true);
    }
    else if (event.type === "attestation") {
      this.patch({ attestation: event.status });
      const trusted = event.status.kind === "mock" || event.status.kind === "verified";
      if (event.status.kind === "clock" || event.status.kind === "unverified") this.trustLost = true;
      else if (trusted && this.trustLost) {
        this.trustLost = false;
        // A stale feed's return reads everything again, so trust regained under it does not.
        if (this.snapshot.stream !== "stale") void this.refresh(true);
      }
    }
  }

  /** Judges the attestation and probes access. Run at start and after a change of region. */
  async checkNode(): Promise<void> {
    try {
      this.patch({ attestation: await this.deps.client.verify() });
    } catch (error) {
      this.patch({ attestation: { kind: "unverified", reason: error instanceof Error ? error.message : "The attestation could not be read." } });
    }
    // A node whose markets have not loaded yet is read once it is trusted.
    if (this.snapshot.markets.length === 0 && maySign(this.snapshot.attestation, "live")) await this.refresh(true);
    try {
      await this.deps.client.accessProbe();
      this.patch({ blocked: null });
    } catch (error) {
      if (!this.noteAccess(error)) this.toast("error", "The node did not answer the access check.");
    }
  }

  private onMessage(message: StreamMessage): void {
    const viewer = this.snapshot.wallet?.address ?? this.viewer;
    for (const event of message.events) {
      if (event.type === "close_out" && isMine(event, viewer)) {
        this.toast("error", "Your account was closed out: its equity fell below half its margin, so positions were closed at market. See History.");
      }
      // A resting order the node cancels later, on a tick, is something the user must be told.
      if (event.type === "order_cancelled" && event.reason !== "client" && isMine(event, viewer)) {
        this.toast("error", `Order ${event.order_id} could not be filled and was cancelled.`);
      }
    }
    this.pacing?.observe(message);
    this.ledger.ingest(message);
    const lines = feedFrom([message], this.snapshot.markets, viewer, () => this.id());
    // Price updates change nothing on screen by themselves; only the node's tick moves the clock and the log.
    if (message.cmd.type === "prices" && lines.length === 0) return;
    this.patch({ now: message.ts, feed: [...lines, ...this.snapshot.feed].slice(0, FEED_LIMIT) });
    // An event for the connected account, from any command, may have changed its history too.
    const mine = this.snapshot.wallet?.address.toLowerCase();
    const own = mine !== undefined && message.events.some((e) => "account" in e && e.account.toLowerCase() === mine);
    if (own) {
      // A deposit or declaration that credits the account is the moment its one-signature login may run.
      loginOnCredit(this, message.events, mine);
      void this.refresh(true);
    } else if (message.cmd.type === "tick") {
      const accountChanged = message.events.some((e) => "account" in e);
      if (this.pacing) this.pacing.readOnTick(accountChanged);
      else void this.refresh(accountChanged);
    }
  }

  /** Re-reads markets, house, and the connected account; a call made while one runs waits, then reads again. */
  refresh(accountChanged: boolean): Promise<void> {
    if (this.inflight) {
      this.rerun = { accountChanged: accountChanged || (this.rerun?.accountChanged ?? false) };
      return this.inflight;
    }
    const run = this.readAll(accountChanged).finally(() => { this.inflight = null; });
    this.inflight = run;
    return run;
  }

  private async readAll(accountChanged: boolean): Promise<void> {
    try {
      const [views, house] = await Promise.all([this.deps.client.markets(), this.deps.client.house()]);
      const decoded = views.map((view) => decodeMarket(view, this.snapshot.markets.find((m) => m.id === view.id), this.deps.client.signatures === "none"));
      const markets = this.pacing?.reconcile(views, decoded) ?? decoded;
      const bars = tickBars(this, markets, this.snapshot.now);
      const selected = markets.some((m) => m.id === this.snapshot.selected) ? this.snapshot.selected : (markets[0]?.id ?? this.snapshot.selected);
      this.patch({ markets, bars, selected, house: decodeHouse(house), houseReady: true, houseFresh: true });
      // The chart's history comes from the marks endpoint once a live node's list has arrived; a
      // node that 404s it keeps asking for the archive scan until it names a log head.
      this.barsSeed.seed(selected, this.snapshot.timeframe);
      this.barsSeed.askScan();
      // loadAccount reports its own failure and never rejects: an account failure cannot stale the figures above.
      if (this.snapshot.wallet) await loadAccount(this, accountChanged);
      this.lastReadError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The node did not answer.";
      if (!this.noteAccess(error) && message !== this.lastReadError) this.toast("error", message);
      this.lastReadError = message;
      // Retained figures stay, marked not fresh, until a refresh reads them again.
      if (this.snapshot.houseReady) this.patch({ houseFresh: false });
    }
    // The house panel's reads run on their own schedule, outside this refresh's lock and error
    // handling: a failing markets or house read must not stop them, and they never delay the next
    // market or account read nor toast as if the whole refresh failed.
    readHousePanelSoon(this);
    const again = this.rerun;
    this.rerun = null;
    if (again) await this.readAll(again.accountChanged);
  }
}
