/** The console's store: reads the node, follows its stream, and notifies the screens. */

import { MAX_BARS, pushTick, TIMEFRAMES, type Bar, type TimeframeId } from "../bars";
import { maySign } from "../engine/attestation";
import { EngineError, type ClientEvent } from "../engine/client";
import type { MarketId, StreamMessage } from "../engine/types";
import type { Wallet } from "../engine/wallet";
import { fixedToNumber } from "../fixed";
import { decodeAccount, decodeHouse, decodeMarket } from "../models";
import { scanBarsHistory } from "./bars-scan";
import { FEED_LIMIT, feedFrom, isMine } from "./feed";
import { initialState, seedAllBars, type BlockReason, type ConsoleState, type ToastMessage } from "./state";
import type { StoreDeps } from "./store-deps";

export class ConsoleStore {
  readonly deps: StoreDeps;
  /** The connected wallet, which holds a signer and so is not part of the snapshot. */
  liveWallet: Wallet | null = null;
  /** The wallet whose reads of the vault's paid payouts are running, one at a time (`checkPaid`). */
  paidCheck: Wallet | null = null;
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
  /** Whether the chart-history scan ran; it runs once, after the first live markets read. */
  private barsScanned = false;
  /** When each market's bar bucket was last ticked from the node's mark, so a history merge can tell a stale live candle from a fresh one. Not part of the snapshot: derived bookkeeping. */
  readonly barTicks: Record<number, Partial<Record<TimeframeId, Map<number, number>>>> = {};
  /** Set when the store stops following the node, so pending history work stands down. Not part of the snapshot. */
  stopped = false;
  /** Bumped on each start, so scans from an earlier cycle stand down when the store restarts (React StrictMode re-runs the effect). Not part of the snapshot. */
  scanEpoch = 0;
  /** Whether trust in the node was lost (a failed check or a wrong clock) and not yet regained. */
  private trustLost = false;
  /** The last read failure shown, so a failure that repeats on every tick is shown once. */
  private lastReadError: string | null = null;

  constructor(deps: StoreDeps) {
    this.deps = deps;
    this.viewer = deps.initial.viewer;
    const state = initialState(deps.initial.markets, deps.initial.house, deps.initial.startMs, deps.history, deps.client.signatures);
    const session = deps.initial.session;
    this.snapshot = {
      ...state,
      feed: feedFrom(deps.initial.recent ?? [], state.markets, this.viewer, () => this.id()),
      ...(session
        ? { wallet: session.wallet, account: session.account ? decodeAccount(session.account) : null, eligibility: session.eligibility, queue: session.queue, history: session.history }
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

  id(): number {
    return this.nextId++;
  }

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
  }

  /** Sets the connected wallet (or none) and drops activity lines that belong to another account. */
  setWallet(wallet: { address: string; label: string; readOnly?: boolean } | null): void {
    this.viewer = undefined; // once a wallet has been connected or left, the starting viewer no longer applies
    const mine = wallet?.address.toLowerCase();
    this.patch({ wallet, feed: this.snapshot.feed.filter((line) => line.account === undefined || line.account === mine) });
  }

  setPaused(paused: boolean): void {
    this.patch({ paused });
  }

  setTimeframe(timeframe: TimeframeId): void {
    this.patch({ timeframe });
  }

  setFundingOpen(open: boolean): void {
    this.patch({ fundingOpen: open });
  }

  /** Marks the caller as refused when `error` is an access refusal; true if it was. */
  noteAccess(error: unknown): boolean {
    if (error instanceof EngineError && error.reject?.kind === "access") {
      const reason = error.reject.reason;
      if (reason === "united_states" || reason === "sanctioned_jurisdiction") {
        this.patch({ blocked: reason satisfies BlockReason, fundingOpen: false });
        return true;
      }
    }
    return false;
  }

  /**
   * Starts following the node at `nowMs`: checks its attestation and access, redraws the charts
   * from that instant, and subscribes to the stream.
   */
  start(nowMs: number): () => void {
    // A restart (React StrictMode re-runs the effect) cancels the previous cycle's pending
    // history work and scans anew: its results were discarded when the cycle stopped.
    this.stopped = false;
    this.scanEpoch += 1;
    this.barsScanned = false;
    this.deps.drive?.(nowMs);
    this.patch({ now: nowMs, bars: seedAllBars(this.snapshot.markets, nowMs, this.deps.history) });
    this.unwatch = this.deps.client.watch((event) => this.onClientEvent(event));
    this.unsubscribe = this.deps.client.subscribe((message) => this.onMessage(message));
    void this.checkNode();
    return () => {
      this.stopped = true;
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
      if (read) void this.refresh(true);
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
    const lines = feedFrom([message], this.snapshot.markets, viewer, () => this.id());
    // Price updates change nothing on screen by themselves; only the node's tick moves the clock and the log.
    if (message.cmd.type === "prices" && lines.length === 0) return;
    this.patch({ now: message.ts, feed: [...lines, ...this.snapshot.feed].slice(0, FEED_LIMIT) });
    // An event for the connected account, from any command, may have changed its history too.
    const mine = this.snapshot.wallet?.address.toLowerCase();
    const own = mine !== undefined && message.events.some((e) => "account" in e && e.account.toLowerCase() === mine);
    if (own) void this.refresh(true);
    else if (message.cmd.type === "tick") void this.refresh(message.events.some((e) => "account" in e));
  }

  /**
   * Re-reads markets, house, and the connected account. A call made while one runs waits for it and
   * then reads again, since the running read may predate the change that prompted the call.
   */
  refresh(accountChanged: boolean): Promise<void> {
    if (this.inflight) {
      this.rerun = { accountChanged: accountChanged || (this.rerun?.accountChanged ?? false) };
      return this.inflight;
    }
    const run = this.readAll(accountChanged).finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async readAll(accountChanged: boolean): Promise<void> {
    try {
      const [views, house] = await Promise.all([this.deps.client.markets(), this.deps.client.house()]);
      const markets = views.map((view) => decodeMarket(view, this.snapshot.markets.find((m) => m.id === view.id), this.deps.client.signatures === "none"));
      const bars = { ...this.snapshot.bars };
      for (const m of markets) {
        if (m.mark === null || !m.open) continue;
        const price = fixedToNumber(m.mark);
        // A market first seen now, as a live node's list arrives, starts from the history source.
        const frames = bars[m.id] ?? (Object.fromEntries(TIMEFRAMES.map((tf) => [tf.id, this.deps.history(m.symbol, tf.seconds, this.snapshot.now, price)])) as Record<TimeframeId, Bar[]>);
        // `fromEntries` loses the key type; the keys are exactly the timeframes `frames` holds.
        // Before the node's first message there is no node time to place a bar at.
        bars[m.id] = this.snapshot.now === 0 ? frames : (Object.fromEntries(TIMEFRAMES.map((tf) => {
          const next = pushTick(frames[tf.id], this.snapshot.now, price, tf.seconds);
          // A closed or unpriced market's candle is untouched, so its last tick stays where it was.
          const bucket = Math.floor(this.snapshot.now / 1000 / tf.seconds) * tf.seconds;
          const ticks = (this.barTicks[m.id] ?? {}) as Record<TimeframeId, Map<number, number>>;
          const series = (ticks[tf.id] ?? new Map<number, number>()) as Map<number, number>;
          series.set(bucket, this.snapshot.now);
          for (const at of series.keys()) if (at < bucket - MAX_BARS * tf.seconds) series.delete(at);
          this.barTicks[m.id] = { ...ticks, [tf.id]: series };
          return [tf.id, next];
        })) as typeof frames);
      }
      const selected = markets.some((m) => m.id === this.snapshot.selected) ? this.snapshot.selected : (markets[0]?.id ?? this.snapshot.selected);
      this.patch({ markets, bars, selected, house: decodeHouse(house) });
      // A live node's chart history is not in any of its reads; one bounded scan of the log seeds it.
      // The flag takes the scan's answer: false when the node has not named a log head yet, so the
      // next read tries again; retries and the failure report live in bars-scan.ts.
      if (!this.barsScanned && this.deps.client.signatures === "checked") this.barsScanned = scanBarsHistory(this, markets, this.deps.scanClock);
      if (this.snapshot.wallet) await this.loadAccount(accountChanged);
      this.lastReadError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The node did not answer.";
      if (!this.noteAccess(error) && message !== this.lastReadError) this.toast("error", message);
      this.lastReadError = message;
    }
    const again = this.rerun;
    this.rerun = null;
    if (again) await this.readAll(again.accountChanged);
  }

  /** Reads the connected account's state; a never-credited account is an empty one. */
  async loadAccount(withHistory: boolean): Promise<void> {
    const wallet = this.snapshot.wallet;
    if (!wallet) return;
    const { client } = this.deps;
    const [eligibility, queue] = await Promise.all([client.eligibility(wallet.address), client.withdrawalQueue(wallet.address)]);
    let account = null;
    try {
      account = decodeAccount(await client.account(wallet.address));
    } catch (error) {
      if (!(error instanceof EngineError && error.status === 404)) throw error;
    }
    // The wallet may have changed while the reads ran; an answer for another account is dropped.
    if (this.snapshot.wallet?.address !== wallet.address) return;
    this.patch({ eligibility: eligibility.class, queue: queue.queue, account });
    if (withHistory || this.snapshot.history.length === 0) {
      const history = (await client.history(wallet.address, { limit: 100 })).events;
      if (this.snapshot.wallet?.address === wallet.address) this.patch({ history });
    }
  }
}
