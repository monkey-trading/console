/** The console's store: reads the node, follows its stream, and notifies the screens. */

import type { TimeframeId } from "../bars";
import { readBlock } from "../engine/attestation";
import type { ClientEvent } from "../engine/client";
import type { SessionKeySigner } from "../engine/session-key";
import type { MarketId, StreamMessage } from "../engine/types";
import type { Wallet } from "../engine/wallet";
import { MonkeySession } from "../monkey/wallet-queue";
import { decodeAccount, decodeHouse, decodeMarket } from "../models";
import { loadAccount } from "./account";
import { creditDeposits } from "./deposits";
import { tickBars } from "./bars-tick";
import { BarsSeed } from "./bars-seed";
import { ExitWatch } from "./exit";
import { eventAccount, FEED_LIMIT, feedFrom, isMine } from "./feed";
import { LedgerReads } from "./ledger";
import { initialState, KEPT_ON_WALLET_CHANGE, seedAllBars, type ConsoleState, type Notice, type NoticeSurface } from "./state";
import { readHousePanelSoon } from "./house";
import { HouseStats } from "./house-stats";
import { PacedReads } from "./paced-reads";
import { QuietReads } from "./quiet-reads";
import { noteAccess } from "./signing";
import type { StoreDeps } from "./store-deps";
import { followSessionKey, noteSessionRevoked } from "./wallet-session";

export class ConsoleStore {
  readonly deps: StoreDeps;
  /** The connected wallet, which holds a signer and so is not part of the snapshot. */
  liveWallet: Wallet | null = null;
  /** The in-browser key trading signs with (console#68, #168), or the connection's candidate until it is registered; never in the snapshot, which holds its expiry alone. */
  sessionKey: SessionKeySigner | null = null;
  /** The login in flight, so concurrent callers share one attempt and one wallet prompt. */
  sessionLogin: Promise<boolean> | null = null;
  /** The previous disconnect's revocation and release, awaited before the next connect adopts. */
  walletCleanup: Promise<void> | null = null;
  /** Bookkeeping for the background vault reads: `paidCheck` and `emissionsCheck` name the wallet each runs for. */
  paidCheck: Wallet | null = null; emissionsCheck: Wallet | null = null;
  /** The vault's deposit ids the stream has shown credited, so a read that predates the credit does not bring one back. Not part of the snapshot. */
  readonly creditedDeposits = new Set<string>();
  /** Counts the reads of the vault's deposit events, so one that a later read overtook is dropped. Not part of the snapshot. */
  depositReads = 0;
  readonly monkeySession = new MonkeySession(); // the MONKEY and Staking pages' wallet queue and, while one is on screen, its store
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
  /** The reads a 404 holds back (a node without the House state route, an account not yet credited); not part of the snapshot. */ readonly quiet = new QuietReads();
  /** When each market's bar bucket was last ticked from the node's mark; a merge tells a stale candle from a fresh one. Not part of the snapshot. */
  readonly barTicks: Record<number, Partial<Record<TimeframeId, Map<number, number>>>> = {};
  /** Whether the session moved to another node's store: what this one's work then comes to says nothing of the wallet's connection. */ movedAway = false;
  /** Stand-down flags for pending history work, bumped on each start; not part of the snapshot. */
  stopped = false; scanEpoch = 0;
  /** Whether trust in the node was lost (a failed check or a wrong clock) and not yet regained. */
  private trustLost = false;
  /** Whether the House page is on screen, the only time its reads run. */
  housePanelOpen = false; houseRead: Promise<void> | null = null;
  /** The house panel's queue walk in flight, guarded apart from the log reads. Not part of the snapshot. */
  queueRead: Promise<void> | null = null;
  readonly exit = new ExitWatch(this); // keeps the account's exit proof at the vault's latest root
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
        ? { wallet: session.wallet, account: session.account ? decodeAccount(session.account) : null, eligibility: session.eligibility, queue: session.queue, accountRead: true, accountHistory: "read" as const, history: session.history }
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

  /** Puts `text` on `surface`, in place of what it held. It stays until the next action on that control or a change that makes it stale clears it. */
  notify(surface: NoticeSurface, text: string, tone: Notice["tone"] = "error"): void {
    this.patch({ notices: { ...this.snapshot.notices, [surface]: { id: this.id(), tone, text } } });
  }

  /** Clears what `surfaces` hold; nothing changes, and nothing is notified, when they hold nothing. */
  clearNotice(...surfaces: NoticeSurface[]): void {
    const { notices } = this.snapshot;
    if (!surfaces.some((surface) => notices[surface] !== undefined)) return;
    const kept = { ...notices };
    for (const surface of surfaces) delete kept[surface];
    this.patch({ notices: kept });
  }

  select(id: MarketId): void {
    this.clearNotice("ticket", "chart"); // a refused order, and a chart that failed to load, name the market they were for
    this.patch({ selected: id });
    this.barsSeed.retry(id, this.snapshot.timeframe);
    this.barsSeed.seed(id, this.snapshot.timeframe);
  }

  /** Sets the connected wallet (or none) and drops activity lines that belong to another account. */
  setWallet(wallet: { address: string; label: string; readOnly?: boolean } | null): void {
    this.ledger.walletChanged(wallet?.address);
    this.viewer = undefined; // once a wallet has been connected or left, the starting viewer no longer applies
    this.quiet.accountEvent(); // its account reads start fresh: no rest of the last wallet's reads holds
    const mine = wallet?.address.toLowerCase();
    // A deposit on its way belongs to the account it was sent to: another wallet drops it, a reconnect of the same one keeps it.
    const sameAccount = this.snapshot.wallet?.address.toLowerCase() === mine;
    this.patch({ wallet, accountRead: false, accountHistory: "waiting", ...(sameAccount ? {} : { pendingDeposits: [] }), notices: Object.fromEntries(Object.entries(this.snapshot.notices).filter(([surface]) => KEPT_ON_WALLET_CHANGE.includes(surface as NoticeSurface))), feed: this.snapshot.feed.filter((line) => line.account === undefined || line.account === mine) });
  }

  setPaused(paused: boolean): void {
    this.patch({ paused });
  }

  setTimeframe(timeframe: TimeframeId): void {
    this.clearNotice("chart"); // it names the series that failed
    this.patch({ timeframe });
    this.barsSeed.retry(this.snapshot.selected, timeframe);
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
    const unfollow = followSessionKey(this);
    this.patch({ now: nowMs, bars: seedAllBars(this.snapshot.markets, nowMs, this.deps.history) });
    this.unwatch = this.deps.client.watch((event) => this.onClientEvent(event));
    this.unsubscribe = this.deps.client.subscribe((message) => this.onMessage(message));
    void this.checkNode();
    return () => {
      this.stopped = true;
      unfollow();
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
      if (event.status === "live") this.clearNotice("feed");
      // The frame's signed time moves the node clock first, so a read it prompts plots marks at node time, not the pre-outage time.
      this.patch({ stream: event.status, ...(event.time !== undefined && event.time > this.snapshot.now ? { now: event.time } : {}) });
      if (read) {
        this.ledger.invalidate(); // the stream resumes at the live end: events from the gap are read again
        this.quiet.reset(); // a node that was away may have restarted with the route, or credited the account
        void this.refresh(true);
      }
    } else if (event.type === "problem") this.notify("feed", event.reason);
    // Data read under the old enclave is read again once the new one is trusted; a check that ends
    // at the same address changes nothing, so a read that keeps failing is not repeated by it.
    else if (event.type === "enclave") {
      this.trustLost = false; // this read is the one trust regained would ask for
      void this.refresh(true);
    }
    else if (event.type === "attestation") {
      this.patch({ attestation: event.status });
      const trusted = event.status.kind === "mock" || event.status.kind === "verified" || event.status.kind === "attested";
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
    if (this.snapshot.markets.length === 0 && readBlock(this.snapshot.attestation, "live") === null) await this.refresh(true);
    try {
      await this.deps.client.accessProbe();
      this.patch({ blocked: null, accessChecked: true });
    } catch (error) {
      this.noteAccess(error);
      this.patch({ accessChecked: true });
    }
  }

  private onMessage(message: StreamMessage): void {
    const viewer = this.snapshot.wallet?.address ?? this.viewer;
    // A close-out, or a resting order the node cancels later on a tick, leaves the user with less than they placed and no control to say why.
    const closedOut = message.events.some((event) => event.type === "close_out" && isMine(event, viewer));
    const cancelled = message.events.flatMap((event) => (event.type === "order_cancelled" && event.reason !== "client" && isMine(event, viewer) ? [event.order_id] : []));
    if (closedOut) this.notify("account", "Your account was closed out: its equity fell below half its margin, so positions were closed at market. See History.");
    else if (cancelled.length > 0) this.notify("account", `${cancelled.length === 1 ? `Order ${cancelled[0]}` : `Orders ${cancelled.join(", ")}`} could not be filled and ${cancelled.length === 1 ? "was" : "were"} cancelled.`);
    this.pacing?.observe(message);
    this.ledger.ingest(message);
    const lines = feedFrom([message], this.snapshot.markets, viewer, () => this.id());
    // Price updates change nothing on screen by themselves; only the node's tick moves the clock and the log.
    if (message.cmd.type === "prices" && lines.length === 0) return;
    this.patch({ now: message.ts, feed: [...lines, ...this.snapshot.feed].slice(0, FEED_LIMIT) });
    // An event for the connected account, from any command, may have changed its history too.
    const mine = this.snapshot.wallet?.address.toLowerCase();
    const own = mine !== undefined && message.events.some((e) => eventAccount(e) === mine);
    if (own) {
      noteSessionRevoked(this, message.events);
      if (mine !== undefined) creditDeposits(this, message.events, mine);
      this.quiet.accountEvent(); // the credit this event may carry is read at once, not at the next rest's end
      void this.refresh(true);
    } else if (message.cmd.type === "tick") {
      const accountChanged = message.events.some((e) => "account" in e && e.account !== null);
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
    } catch (error) {
      this.noteAccess(error);
      // Retained figures stay, marked not fresh, until a refresh reads them again.
      if (this.snapshot.houseReady) this.patch({ houseFresh: false });
    }
    // The house panel's reads run on their own schedule, outside this refresh's lock and error
    // handling: a failing markets or house read must not stop them, and they never delay the next
    // market or account read.
    readHousePanelSoon(this);
    const again = this.rerun;
    this.rerun = null;
    if (again) await this.readAll(again.accountChanged);
  }
}
