/**
 * The MONKEY page's reads. It is a store of its own, opened only while the page is on screen: the
 * node's totals and the activity are read about every 30 seconds, each chart on open, on a change
 * of timeframe and, with its Live switch on, every 5 seconds; the wallet's chain reads run on load
 * and after a transaction, one at a time, never on a timer. Failed reads show on their panels
 * and are tried again at the next read, with no toast; the one exception is the vault's MONKEY
 * record, read with the wallet's, which reports a failure as it always has, once for a failed read and again for a call the wallet did not answer in time.
 */

import type { ActivityPage, DistributionProof, MonkeyView } from "../engine/stats-types";
import type { StakingPosition } from "../engine/staking";
import type { Wallet } from "../engine/wallet";
import { checkEmissionsClaimed } from "../store/emissions";
import type { ConsoleStore } from "../store/store";
import { ChartFeed } from "./feed";
import { failed, LOADING, ready, type Read } from "./figures";

/** The activity table's length, and how often the page's totals and activity are read, in milliseconds. */
export const ACTIVITY_LIMIT = 25;
export const NODE_READ_MS = 30_000;
/** The page's one timer: the Live switches' cadence, and the unit the slower reads count in. */
export const LIVE_READ_MS = 5_000;

/** What the connected account holds on chain and what the node proves it was distributed. */
export interface WalletFigures {
  /** The address these figures are for; null with no wallet. */
  address: string | null;
  /** The wallet's chain reads; unavailable for a wallet that reads no chain, such as a watched account's. */
  position: Read<StakingPosition>;
  /** The account's distribution proof; null when the node holds none. */
  proof: Read<DistributionProof | null>;
}

export interface PanelState {
  overview: Read<MonkeyView>;
  activity: Read<ActivityPage>;
  wallet: WalletFigures;
}

const NO_WALLET: WalletFigures = { address: null, position: LOADING, proof: LOADING };

export class MonkeyPanel {
  readonly feeds: Record<"epochs" | "perLoss" | "supply" | "rewards", ChartFeed>;
  private state: PanelState = { overview: LOADING, activity: LOADING, wallet: NO_WALLET };
  private readonly listeners = new Set<() => void>();
  private nodeRead: Promise<void> | null = null;
  /** Counts the page's openings; work that began in an earlier one never writes into a later one. */
  private cycle = 0;
  private open = false;

  constructor(readonly store: ConsoleStore) {
    const reads = store.deps.client.stats;
    const now = () => store.getSnapshot().now;
    const active = () => this.open;
    this.feeds = {
      epochs: new ChartFeed(["distributed_per_epoch"], reads, now, active, "7d"),
      perLoss: new ChartFeed(["monkey_per_loss"], reads, now, active, "all"),
      supply: new ChartFeed(["total_allocated", "total_staked"], reads, now, active, "all"),
      rewards: new ChartFeed(["cumulative_distributed"], reads, now, active, "all"),
    };
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

  /**
   * Starts the page's reads and its timer, and returns what stops them and forgets what they read.
   * Called once the node is trusted; while `isHidden` says the tab is hidden the timer reads nothing.
   */
  start(isHidden: () => boolean): () => void {
    this.open = true;
    this.cycle = this.store.monkeySession.nextOpening();
    this.store.monkeySession.panel = this;
    void this.refreshNode();
    for (const feed of Object.values(this.feeds)) void feed.load();
    let ticks = 0;
    const timer = setInterval(() => {
      if (isHidden()) return;
      ticks += 1;
      // A node that predates both routes is not asked again until the page is reopened.
      if (ticks % (NODE_READ_MS / LIVE_READ_MS) === 0 && !(this.state.overview.status === "unavailable" && this.state.activity.status === "unavailable")) void this.refreshNode();
      for (const feed of Object.values(this.feeds)) void feed.tickLive();
    }, LIVE_READ_MS);
    return () => {
      this.open = false;
      this.cycle = this.store.monkeySession.nextOpening();
      this.nodeRead = null;
      if (this.store.monkeySession.panel === this) this.store.monkeySession.panel = null;
      clearInterval(timer);
      for (const feed of Object.values(this.feeds)) feed.close();
      this.set({ overview: LOADING, activity: LOADING, wallet: NO_WALLET });
    };
  }

  /** Reads the totals and the activity, one read of each at a time. */
  refreshNode(): Promise<void> {
    if (!this.open) return Promise.resolve();
    if (this.nodeRead !== null) return this.nodeRead;
    const { stats } = this.store.deps.client;
    const cycle = this.cycle;
    const run = async () => {
      const [overview, activity] = await Promise.allSettled([stats.monkey(), stats.activity({ limit: ACTIVITY_LIMIT })]);
      if (cycle !== this.cycle || !this.open) return;
      this.set({
        overview: overview.status === "fulfilled" ? ready(overview.value) : failed(overview.reason, this.state.overview.value),
        activity: activity.status === "fulfilled" ? ready(activity.value) : failed(activity.reason, this.state.activity.value),
      });
    };
    const read = run().finally(() => {
      if (this.nodeRead === read) this.nodeRead = null;
    });
    this.nodeRead = read;
    return read;
  }

  /**
   * Reads what the connected wallet holds on chain, one call after another, then the node's
   * distribution proof for it and the vault's record of its MONKEY claims. Called on load, when the
   * wallet changes, when the node is trusted again, on the visitor's Refresh and after a transaction. It queues behind the
   * wallet's earlier work ([WalletQueue]): a read already waiting or running serves this one too,
   * unless `fresh` asks for one that starts after what is running now, which a transaction needs.
   */
  refreshWallet(fresh = false): Promise<void> {
    const wallet = this.store.liveWallet;
    if (wallet === null) {
      this.set({ wallet: NO_WALLET });
      return Promise.resolve();
    }
    const cycle = this.cycle;
    if (this.state.wallet.address !== wallet.address) this.set({ wallet: { ...NO_WALLET, address: wallet.address } });
    // The node's proof needs nothing from the wallet, so it is not held up behind a call the wallet has not answered.
    const proof = this.readProof(wallet, cycle);
    // A read still waiting for the wallet to answer an earlier call says so once the time limit has passed, instead of reading "Reading…" with no reason.
    let started = false;
    const waiting = setTimeout(() => {
      if (!started && this.open && cycle === this.cycle && this.store.liveWallet === wallet && this.state.wallet.position.status !== "failed") {
        this.set({ wallet: { ...this.state.wallet, address: wallet.address, position: failed(new Error("Your wallet has not answered an earlier request."), this.state.wallet.position.value) } });
      }
    }, WALLET_READ_MS);
    const chain = this.store.monkeySession.walletWork.read(wallet, fresh, cycle, () => {
      started = true;
      clearTimeout(waiting);
      return this.readWallet(wallet, cycle);
    }).finally(() => clearTimeout(waiting));
    return Promise.all([proof, chain]).then(() => undefined);
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
    const current = () => this.open && cycle === this.cycle && this.store.liveWallet === wallet;
    try {
      const proof = ready(await this.store.deps.client.stats.distributions(wallet.address));
      if (current()) this.set({ wallet: { ...this.state.wallet, address: wallet.address, proof } });
    } catch (error) {
      if (current()) this.set({ wallet: { ...this.state.wallet, address: wallet.address, proof: failed(error, this.state.wallet.proof.value) } });
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
    let position: Read<StakingPosition> = { status: "unavailable", value: null, message: null };
    if (wallet.staking !== undefined) {
      try {
        position = ready(await bounded(wallet.staking.position()));
      } catch (error) {
        position = failed(error, held.position.value);
      }
    }
    if (current()) this.set({ wallet: { ...this.state.wallet, address: wallet.address, position } });
    // The vault's record of this account's MONKEY claims, for the emissions card: read here so it
    // follows the same queue and never runs on the node's clock.
    // Any call the wallet has not answered is settled before the next is asked.
    await Promise.all(outstanding);
    if (current()) {
      try {
        await bounded(checkEmissionsClaimed(this.store));
      } catch (error) {
        // `checkEmissionsClaimed` reports its own failures; what reaches here is the wallet not answering in time. The queue holds until it does, so the next such report is for a later read.
        this.store.toast("error", `The vault's MONKEY record could not be read: ${error instanceof Error ? error.message : "the read failed"}`);
      }
    }
    await Promise.all(outstanding);
  }
}

/** How long the wallet's reads may take before a read fails into its figures, in milliseconds. */
const WALLET_READ_MS = 30_000;

/** `read`, or a rejection once `ms` has passed without it settling. */
function withTimeout<T>(read: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Your wallet did not answer in time.")), ms);
    read.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}
