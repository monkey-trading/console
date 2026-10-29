/** The console's store: reads the node, follows its stream, and notifies the screens. */

import { pushTick, TIMEFRAMES, type Bar, type TimeframeId } from "../bars";
import { maySign } from "../engine/attestation";
import { EngineError, type ClientEvent, type EngineClient } from "../engine/client";
import type { AccountView, EligibilityClass, EngineEvent, HistoryEvent, HouseView, MarketId, MarketView, QueuedWithdrawal, StreamMessage } from "../engine/types";
import type { Wallet, WalletConnector } from "../engine/wallet";
import { fixedToNumber } from "../fixed";
import { describeEvent } from "../messages";
import { decodeAccount, decodeHouse, decodeMarket } from "../models";
import { initialState, seedAllBars, type BlockReason, type ConsoleState, type FeedLine, type HistorySource, type ToastMessage } from "./state";

const FEED_LIMIT = 150;

export interface StoreDeps {
  client: EngineClient;
  wallets: WalletConnector;
  /** Advances a node that runs in this page; absent for a live node. */
  drive?: (ms: number) => void;
  initial: { markets: MarketView[]; house: HouseView; startMs: number; recent?: StreamMessage[]; /** The account whose events the activity log shows before a wallet connects. */ viewer?: string;
    /** A wallet already connected when the page loads, with what the node holds for it. */
    session?: { wallet: { address: string; label: string }; account: AccountView | null; eligibility: EligibilityClass | null; queue: QueuedWithdrawal[]; history: HistoryEvent[] };
  };
  /** Price history for the chart, ending at the current mark. */
  history: HistorySource;
}

export class ConsoleStore {
  readonly deps: StoreDeps;
  /** The connected wallet, which holds a signer and so is not part of the snapshot. */
  liveWallet: Wallet | null = null;
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

  constructor(deps: StoreDeps) {
    this.deps = deps;
    this.viewer = deps.initial.viewer;
    const state = initialState(deps.initial.markets, deps.initial.house, deps.initial.startMs, deps.history, deps.client.signatures);
    const session = deps.initial.session;
    this.snapshot = {
      ...state,
      feed: this.feedFrom(deps.initial.recent ?? [], state.markets),
      ...(session
        ? { wallet: session.wallet, account: session.account ? decodeAccount(session.account) : null, eligibility: session.eligibility, queue: session.queue, history: session.history }
        : {}),
    };
  }

  /** Whether the node is the in-browser mock, whose quotes are simulated. */
  private get simulated(): boolean {
    return this.deps.client.signatures === "none";
  }

  /** Whether an event belongs in this user's activity: market events, and events of their own account. */
  private isMine(event: EngineEvent): boolean {
    if (!("account" in event)) return true;
    const mine = this.snapshot?.wallet?.address ?? this.viewer;
    return mine !== undefined && event.account.toLowerCase() === mine.toLowerCase();
  }

  /** Activity lines for a batch of messages, newest first, as the stream handler adds them. */
  private feedFrom(messages: readonly StreamMessage[], markets: readonly { id: MarketId; symbol: string }[]): FeedLine[] {
    const symbolOf = (id: MarketId) => markets.find((m) => m.id === id)?.symbol ?? `market ${id}`;
    const lines = messages.flatMap((message) =>
      message.events.flatMap((event) => {
        if (!this.isMine(event)) return [];
        const text = describeEvent(event, symbolOf);
        return text === null ? [] : [{ id: this.id(), ts: message.ts, text, ...("account" in event ? { account: event.account.toLowerCase() } : {}) }];
      }),
    );
    return lines.reverse().slice(0, FEED_LIMIT);
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
  setWallet(wallet: { address: string; label: string } | null): void {
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
    this.deps.drive?.(nowMs);
    this.patch({ now: nowMs, bars: seedAllBars(this.snapshot.markets, nowMs, this.deps.history) });
    this.unwatch = this.deps.client.watch((event) => this.onClientEvent(event));
    this.unsubscribe = this.deps.client.subscribe((message) => this.onMessage(message));
    void this.checkNode();
    return () => {
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
    if (event.type === "feed") this.patch({ stream: event.status });
    else if (event.type === "problem") this.toast("error", event.reason);
    // Data read under the old enclave is read again once the new one is trusted; a check that ends
    // at the same address changes nothing, so a read that keeps failing is not repeated by it.
    else if (event.type === "enclave") void this.refresh(true);
    else {
      const was = this.snapshot.attestation.kind;
      this.patch({ attestation: event.status });
      const trusted = event.status.kind === "mock" || event.status.kind === "verified";
      if (trusted && (was === "clock" || was === "unverified")) void this.refresh(true);
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
    for (const event of message.events) {
      if (event.type === "close_out" && this.isMine(event)) {
        this.toast("error", "Your account was closed out: its equity fell below half its margin, so positions were closed at market. See History.");
      }
      // A resting order the node cancels later, on a tick, is something the user must be told.
      if (event.type === "order_cancelled" && event.reason !== "client" && this.isMine(event)) {
        this.toast("error", `Order ${event.order_id} could not be filled and was cancelled.`);
      }
    }
    const lines = message.events.flatMap((event) => {
      if (!this.isMine(event)) return [];
      const text = describeEvent(event, (id) => this.snapshot.markets.find((m) => m.id === id)?.symbol ?? `market ${id}`);
      return text === null ? [] : [{ id: this.id(), ts: message.ts, text, ...("account" in event ? { account: event.account.toLowerCase() } : {}) }];
    });
    // Price updates change nothing on screen by themselves; only the node's tick moves the clock and the log.
    if (message.cmd.type === "prices" && lines.length === 0) return;
    this.patch({ now: message.ts, feed: [...lines.reverse(), ...this.snapshot.feed].slice(0, FEED_LIMIT) });
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
      const markets = views.map((view) => decodeMarket(view, this.snapshot.markets.find((m) => m.id === view.id), this.simulated));
      const bars = { ...this.snapshot.bars };
      for (const m of markets) {
        if (m.mark === null || !m.open) continue;
        const price = fixedToNumber(m.mark);
        // A market first seen now, as a live node's list arrives, starts from the history source.
        const frames = bars[m.id] ?? (Object.fromEntries(TIMEFRAMES.map((tf) => [tf.id, this.deps.history(m.symbol, tf.seconds, this.snapshot.now, price)])) as Record<TimeframeId, Bar[]>);
        // `fromEntries` loses the key type; the keys are exactly the timeframes `frames` holds.
        // Before the node's first message there is no node time to place a bar at.
        bars[m.id] = this.snapshot.now === 0 ? frames : (Object.fromEntries(TIMEFRAMES.map((tf) => [tf.id, pushTick(frames[tf.id], this.snapshot.now, price, tf.seconds)])) as typeof frames);
      }
      const selected = markets.some((m) => m.id === this.snapshot.selected) ? this.snapshot.selected : (markets[0]?.id ?? this.snapshot.selected);
      this.patch({ markets, bars, selected, house: decodeHouse(house) });
      if (this.snapshot.wallet) await this.loadAccount(accountChanged);
    } catch (error) {
      if (!this.noteAccess(error)) this.toast("error", error instanceof Error ? error.message : "The node did not answer.");
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
