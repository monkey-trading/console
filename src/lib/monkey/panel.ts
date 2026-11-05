/** The pages' node figures, charts and wallet reads while trusted and visible, with bounded retries (monkey-trading/console#202, #271, #310). */

import { carryAccrued } from "../engine/claim-standing";
import { withTimeout } from "../engine/provider-errors";
import type { StakingPosition } from "../engine/staking";
import type { Wallet } from "../engine/wallet";
import { checkEmissionsClaimed } from "../store/emissions";
import type { ConsoleStore } from "../store/store";
import { ChartFeed } from "./feed";
import { failed, LOADING, ready, type Read } from "./figures";
import { Backoff, followLive } from "./live-reads";
import { FEEDS, NO_DRAFTS, NO_WALLET, PAGE_FEEDS, type DraftField, type FeedName, type PanelPage, type PanelState } from "./panel-state";
import { proofAwaited, readEntitlement } from "./pending";

/** The activity table's length, and how often the page's totals and activity are read, in milliseconds. */
export const ACTIVITY_LIMIT = 25;
export const NODE_READ_MS = 30_000;
/** The page's one timer: the charts' cadence, and the unit the slower reads count in. */
export const LIVE_READ_MS = 5_000;

export class MonkeyPanel {
  /** This page's charts, by name. */
  private readonly feeds: Partial<Record<FeedName, ChartFeed>>;
  private state: PanelState = { overview: LOADING, activity: LOADING, wallet: NO_WALLET, unmirroredTotal: null, drafts: NO_DRAFTS, settling: false };
  /** Landed transactions whose re-read is still running, for the account connected now. */
  private settlers = 0;
  /** Counts changes of account; a re-read begun for an earlier account never counts against a later one. */
  private accountRound = 0;
  private proofReads = 0;
  private proofLanded = 0;
  private readonly listeners = new Set<() => void>();
  private nodeRead: Promise<void> | null = null;
  private readonly nodeBackoff = new Backoff();
  private readonly walletBackoff = new Backoff();
  /** Counts the page's openings; work that began in an earlier one never writes into a later one. */
  private cycle = 0;
  private open = false;
  private isHidden: () => boolean = () => false;

  constructor(readonly store: ConsoleStore, readonly page: PanelPage) {
    const reads = store.deps.client.stats;
    const now = () => store.getSnapshot().now;
    const active = () => this.open && !this.isHidden();
    this.feeds = Object.fromEntries(PAGE_FEEDS[page].map((name) => [name, new ChartFeed(FEEDS[name].metrics, reads, now, active, FEEDS[name].initial)]));
  }

  /**
   * This page's chart `name`.
   * Error cases:
   * - the chart is another page's, which only a component on the wrong page asks for
   */
  feed(name: FeedName): ChartFeed {
    const feed = this.feeds[name];
    if (feed === undefined) throw new Error(`The ${this.page} page draws no ${name} chart.`);
    return feed;
  }

  /** This page's charts. */
  private charts(): ChartFeed[] {
    return Object.values(this.feeds);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PanelState => this.state;

  private set(partial: Partial<PanelState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  /** Starts trusted reads and their timer, waiting while hidden; returns what stops and forgets them. */
  start(isHidden: () => boolean): () => void {
    this.isHidden = isHidden;
    this.open = true;
    this.cycle = this.store.monkeySession.nextOpening();
    this.store.monkeySession.panel = this;
    let initialPending = isHidden();
    const readInitial = () => {
      initialPending = false;
      void this.refreshNode();
      for (const feed of this.charts()) void feed.load();
    };
    if (!initialPending) readInitial();
    const stopLive = followLive({
      isHidden, open: () => this.open, account: () => this.store.liveWallet?.address.toLowerCase() ?? null,
      subscribe: (onMessage) => this.store.deps.client.subscribe(onMessage),
      readNode: () => void this.refreshNode(),
      readWallet: () => { if (this.page !== "dashboard") void this.refreshWallet(); },
      // A node that predates the routes the page reads is not asked again until the page is reopened.
      nodeDue: () => this.nodeBackoff.ready() && !(this.state.overview.status === "unavailable" && (this.page !== "monkey" || this.state.activity.status === "unavailable")),
      walletDue: () => this.walletBackoff.ready(),
      tickCharts: () => {
        if (initialPending) readInitial();
        else for (const feed of this.charts()) void feed.tickLive();
      },
      // Each page awaits its own claim's proof: the reads the other claim needs stay loading, so it is never awaited here.
      awaitingProof: () => this.page !== "dashboard" && this.store.liveWallet !== null && proofAwaited({ ...this.state, ...this.state.wallet, account: this.store.liveWallet.address, entitlement: this.store.getSnapshot().entitlement, proof: this.state.wallet.proof, position: this.state.wallet.position }),
      readProofs: () => {
        const wallet = this.store.liveWallet;
        if (this.page === "monkey") void readEntitlement(this.store, () => this.open);
        else if (this.page === "staking" && wallet !== null) void this.readProof(wallet, this.cycle);
      },
      watchCheckpoints: (onCheckpoint) => this.store.deps.client.watch((event) => { if (event.type === "checkpoint") onCheckpoint(); }),
      tickMs: LIVE_READ_MS, nodeEveryMs: NODE_READ_MS,
    });
    return () => {
      stopLive();
      this.open = false;
      this.cycle = this.store.monkeySession.nextOpening();
      this.nodeRead = null;
      this.nodeBackoff.reset();
      this.walletBackoff.reset();
      this.settlers = 0;
      if (this.store.monkeySession.panel === this) this.store.monkeySession.panel = null;
      for (const feed of this.charts()) feed.close();
      this.set({ overview: LOADING, activity: LOADING, wallet: NO_WALLET, unmirroredTotal: null, settling: false });
    };
  }

  /** Marks the stake figures as ahead of the node's mirror until its total moves; see [PanelState.unmirroredTotal]. */
  holdShare(): void {
    this.set({ unmirroredTotal: this.state.overview.value?.staking?.total_staked ?? "" });
  }

  /** Keeps what was typed in a field; the field's account is the connected one. */
  setDraft(field: DraftField, text: string): void {
    const account = this.store.liveWallet?.address ?? null;
    this.set({ drafts: { ...(this.state.drafts.account === account ? this.state.drafts : NO_DRAFTS), account, [field]: text } });
  }

  /** Empties a field once what was sent from it has landed, unless the visitor has typed something else since. */
  clearDraft(field: DraftField, sent: string): void {
    if (this.state.drafts[field] === sent) this.set({ drafts: { ...this.state.drafts, [field]: "" } });
  }

  /** Marks a landed transaction's re-read as running; `reread` is that read, after which the forms open again. */
  async settle(reread: Promise<unknown>): Promise<void> {
    const cycle = this.cycle;
    const account = this.accountRound;
    this.settlers += 1;
    this.set({ settling: true });
    await reread.finally(() => {
      // The page was reopened, or another account connected, meanwhile, which reset the count.
      if (cycle !== this.cycle || account !== this.accountRound) return;
      this.settlers -= 1;
      this.set({ settling: this.settlers > 0 });
    });
  }

  /** Reads the totals, with the activity on the MONKEY page, one read of each at a time. */
  refreshNode(): Promise<void> {
    if (!this.open) return Promise.resolve();
    if (this.nodeRead !== null) return this.nodeRead;
    const { stats } = this.store.deps.client;
    const cycle = this.cycle;
    const run = async () => {
      const [overview, activity] = await Promise.allSettled([stats.monkey(), this.page === "monkey" ? stats.activity({ limit: ACTIVITY_LIMIT }) : null]);
      if (cycle !== this.cycle || !this.open) return;
      this.nodeBackoff.record(overview.status === "rejected" || activity.status === "rejected");
      const held = this.state.unmirroredTotal;
      const mirrored = overview.status === "fulfilled" && (overview.value.staking?.total_staked ?? "") !== held;
      this.set({
        unmirroredTotal: mirrored ? null : held,
        overview: overview.status === "fulfilled" ? ready(overview.value) : failed(overview.reason, this.state.overview.value),
        activity: activity.status === "rejected" ? failed(activity.reason, this.state.activity.value) : activity.value === null ? this.state.activity : ready(activity.value),
      });
    };
    const read = run().finally(() => {
      if (this.nodeRead === read) this.nodeRead = null;
    });
    this.nodeRead = read;
    return read;
  }

  /**
   * Reads what the page shows of the connected wallet: on the Staking page its stake on chain and the
   * node's distribution proof for it, on the MONKEY page the vault's record of its MONKEY claims.
   * Called on load, when the wallet changes, when the node is trusted again and after a transaction. It queues behind the
   * wallet's earlier work ([WalletQueue]): a read already waiting or running serves this one too,
   * unless `fresh` asks for one that starts after what is running now, which a transaction needs.
   */
  refreshWallet(fresh = false): Promise<void> {
    const wallet = this.store.liveWallet;
    if (wallet === null) {
      this.accountRound += 1;
      this.settlers = 0;
      this.set({ wallet: NO_WALLET, drafts: NO_DRAFTS, settling: false });
      return Promise.resolve();
    }
    const cycle = this.cycle;
    if (this.state.wallet.address !== wallet.address) {
      // Another account's landed transaction says nothing about this one's figures, so its re-reads no longer hold the forms.
      this.accountRound += 1;
      this.settlers = 0;
      this.set({ wallet: { ...NO_WALLET, address: wallet.address }, unmirroredTotal: null, settling: false });
    }
    // The node's proof needs nothing from the wallet, so it is not held up behind a call the wallet has not answered.
    const proof = this.page === "staking" ? this.readProof(wallet, cycle) : Promise.resolve();
    // The page's wallet read (the stake, or the vault's record) still waiting for the wallet to answer an earlier call says so once the time limit has passed, instead of reading "Reading…" with no reason.
    let started = false;
    const waiting = setTimeout(() => {
      const { position, record } = this.state.wallet;
      if (started || !this.open || cycle !== this.cycle || this.store.liveWallet !== wallet || (this.page === "staking" ? position : record).status === "failed") return;
      const stalled = new Error("Your wallet has not answered an earlier request.");
      this.set({ wallet: { ...this.state.wallet, address: wallet.address, ...(this.page === "staking" ? { position: failed(stalled, position.value) } : { record: failed(stalled, record.value) }) } });
    }, WALLET_READ_MS);
    const chain = this.store.monkeySession.walletWork.read(wallet, fresh, cycle, () => {
      started = true;
      clearTimeout(waiting);
      return this.readWallet(wallet, cycle);
    }).finally(() => clearTimeout(waiting));
    return Promise.all([proof, chain]).then(() => {
      const { position, proof: held, record } = this.state.wallet;
      this.walletBackoff.record([position, held, record].some((read) => read.status === "failed"));
    });
  }

  /**
   * Runs `task`, which asks `wallet`'s provider things, behind the wallet's earlier work, so a
   * transaction's own reads and the confirmation it waits for hold up the page's reads. Resolves
   * null, without running `task`, when another transaction is already waiting or running.
   */
  exclusive<T>(task: () => Promise<T>): Promise<T | null> {
    const wallet = this.store.liveWallet;
    return wallet === null ? task() : this.store.monkeySession.walletWork.transaction(wallet, task);
  }

  /** The node's distribution proof for `wallet`, into the figures; a failure lands there, so this never rejects. */
  private async readProof(wallet: Wallet, cycle: number): Promise<void> {
    // Reads overlap (a Refresh and the read after a transaction), so an answer lands only if no read begun after it has landed already. The order of the reads decides, not the checkpoints the proofs name: the node may now answer at an older checkpoint than an earlier read did.
    const ticket = ++this.proofReads;
    const current = () => this.open && cycle === this.cycle && this.store.liveWallet === wallet && ticket > this.proofLanded;
    const held = () => (this.state.wallet.address === wallet.address ? this.state.wallet.proof.value : null);
    try {
      const answer = await this.store.deps.client.stats.distributions(wallet.address);
      if (current()) {
        this.proofLanded = ticket;
        this.set({ wallet: { ...this.state.wallet, address: wallet.address, proof: ready(answer === null ? null : carryAccrued(held(), answer)) } });
      }
    } catch (error) {
      if (current()) {
        this.proofLanded = ticket;
        this.set({ wallet: { ...this.state.wallet, address: wallet.address, proof: failed(error, this.state.wallet.proof.value) } });
      }
    }
  }

  /**
   * One wallet's reads; every failure lands in the figures, so it never rejects. A call the wallet
   * does not answer in time fails into the figures, but the queue is held until the provider has
   * answered or refused it, so the next piece of work never starts beside it.
   */
  private async readWallet(wallet: Wallet, cycle: number): Promise<void> {
    const current = () => this.open && cycle === this.cycle && this.store.liveWallet === wallet;
    if (!current()) return;
    const outstanding: Promise<unknown>[] = [];
    const bounded = <T>(call: Promise<T>): Promise<T> => {
      outstanding.push(call.catch(() => undefined));
      return withTimeout(call, WALLET_READ_MS);
    };
    const held = this.state.wallet.address === wallet.address ? this.state.wallet : { ...NO_WALLET, address: wallet.address };
    if (this.state.wallet.address !== wallet.address) this.set({ wallet: held });
    if (this.page === "staking") {
      let position: Read<StakingPosition> = { status: "unavailable", value: null, message: null };
      if (wallet.staking !== undefined) {
        try {
          position = ready(await bounded(wallet.staking.position()));
        } catch (error) {
          position = failed(error, held.position.value);
        }
      }
      if (current()) this.set({ wallet: { ...this.state.wallet, address: wallet.address, position } });
    }
    // The vault's record of this account's MONKEY claims, for the emissions card: read here so it
    // follows the same queue and never runs on the node's clock.
    // Any call the wallet has not answered is settled before the next is asked.
    await Promise.all(outstanding);
    if (this.page === "monkey" && current()) {
      let record: Read<true>;
      try {
        await bounded(checkEmissionsClaimed(this.store));
        record = ready(true);
      } catch (error) {
        record = failed(error, held.record.value); // the read's own reason, or the wallet not answering in time
      }
      if (current()) this.set({ wallet: { ...this.state.wallet, address: wallet.address, record } });
    }
    await Promise.all(outstanding);
  }
}

/** How long the wallet's reads may take before a read fails into its figures, in milliseconds. */
const WALLET_READ_MS = 30_000;
