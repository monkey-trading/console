/**
 * The Staking page's read of the connected account's stake and delegations, straight from the chain
 * through its wallet (`StakingWallet.delegations`), whatever the node's state (monkey-trading/console#279):
 * no single operator may stop a staker voting away from it, so a node that is down or unverified
 * never holds this read up. Read on open, when the wallet changes, after any staking transaction
 * (through `monkeySession.delegations`), and every 15 seconds while the tab is visible, one call at a
 * time behind the wallet's other work.
 */

import type { StakeDelegations } from "../engine/staking";
import type { Wallet } from "../engine/wallet";
import { failed, LOADING, ready, type Read } from "../monkey/figures";
import { Backoff, WALLET_READ_EVERY_MS } from "../monkey/live-reads";
import type { ConsoleStore } from "../store/store";

export interface DelegationsState {
  /** The account the read is for; null with no wallet. */
  account: string | null;
  read: Read<StakeDelegations>;
}

/** A wallet with no staking calls, such as a watched account's, reads nothing. */
const NONE = { status: "unavailable", value: null, message: null } as const;
const IDLE: DelegationsState = { account: null, read: LOADING };
/** The reads that have begun asking the wallet, which a later ask no longer joins. */
const started = new WeakSet<Promise<void>>();

export class DelegationReads {
  private state: DelegationsState = IDLE;
  private readonly listeners = new Set<() => void>();
  /** Counts openings and wallet changes; a read begun before one never writes after it. */
  private cycle = 0;
  private open = false;
  /** The read waiting or running for a wallet, which another ask for that wallet joins, so reads never pile up behind a wallet that is slow to answer. */
  private reading: { wallet: Wallet; cycle: number; read: Promise<void> } | null = null;
  /** Spaces the timer's reads out after failures; a read asked for after a transaction is not held back. */
  private readonly backoff = new Backoff();

  constructor(private readonly store: ConsoleStore) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DelegationsState => this.state;

  private set(partial: Partial<DelegationsState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  /** Starts the reads, and returns what stops them and forgets what they read. While `isHidden` says the tab is hidden the timer reads nothing. */
  start(isHidden: () => boolean): () => void {
    this.open = true;
    this.cycle += 1;
    this.store.monkeySession.delegations = this;
    let wallet = this.store.liveWallet;
    void this.refresh();
    const stopFollowing = this.store.subscribe(() => {
      if (this.store.liveWallet === wallet) return;
      wallet = this.store.liveWallet;
      void this.refresh();
    });
    const timer = setInterval(() => {
      if (!isHidden() && this.backoff.ready()) void this.refresh();
    }, WALLET_READ_EVERY_MS);
    return () => {
      this.open = false;
      this.cycle += 1;
      clearInterval(timer);
      stopFollowing();
      if (this.store.monkeySession.delegations === this) this.store.monkeySession.delegations = null;
      this.reading = null;
      this.backoff.reset();
      this.set(IDLE);
    };
  }

  /**
   * Reads the connected wallet's stake and delegations behind its earlier work; another account's
   * figures go at once. A read waiting to start for this wallet serves this ask too: it runs after
   * everything already queued, a transaction included. One that has started does not, as it may
   * predate what the caller has just done. Queued work for a wallet no longer connected, or a page
   * that has closed, reads nothing when its turn comes.
   */
  refresh(): Promise<void> {
    if (!this.open) return Promise.resolve();
    const wallet = this.store.liveWallet;
    const account = wallet?.address ?? null;
    if (account !== this.state.account) {
      this.cycle += 1;
      this.set({ account, read: LOADING });
    }
    const staking = wallet?.staking;
    if (wallet === null || staking === undefined || wallet.readOnly === true) {
      this.set({ read: NONE });
      return Promise.resolve();
    }
    const cycle = this.cycle;
    const waiting = this.reading;
    if (waiting !== null && waiting.wallet === wallet && waiting.cycle === cycle && !started.has(waiting.read)) return waiting.read;
    const current = () => cycle === this.cycle && this.open && this.store.liveWallet === wallet;
    const read: Promise<void> = this.store.monkeySession.walletWork.work(wallet, async () => {
      started.add(read);
      if (!current()) return;
      try {
        const answer = await staking.delegations();
        this.backoff.record(false);
        if (current()) this.set({ read: ready(answer) });
      } catch (error) {
        this.backoff.record(true);
        if (current()) this.set({ read: failed(error, this.state.read.value) });
      }
    }).finally(() => {
      if (this.reading?.read === read) this.reading = null;
    });
    this.reading = { wallet, cycle, read };
    return read;
  }
}
