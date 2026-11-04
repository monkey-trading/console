/**
 * The Staking page's read of the connected account's stake and delegations, straight from the chain
 * through its wallet (`StakingWallet.delegations`), whatever the node's state (monkey-trading/console#279):
 * no single operator may stop a staker voting away from it, so a node that is down or unverified
 * never holds this read up. Read on open, when the wallet changes, after a delegation change, and
 * every 15 seconds while the tab is visible, one call at a time behind the wallet's other work.
 */

import type { StakeDelegations } from "../engine/staking";
import { failed, LOADING, ready, type Read } from "../monkey/figures";
import { WALLET_READ_EVERY_MS } from "../monkey/live-reads";
import type { ConsoleStore } from "../store/store";

export interface DelegationsState {
  /** The account the read is for; null with no wallet. */
  account: string | null;
  read: Read<StakeDelegations>;
}

/** A wallet with no staking calls, such as a watched account's, reads nothing. */
const NONE = { status: "unavailable", value: null, message: null } as const;
const IDLE: DelegationsState = { account: null, read: LOADING };

export class DelegationReads {
  private state: DelegationsState = IDLE;
  private readonly listeners = new Set<() => void>();
  /** Counts openings and wallet changes; a read begun before one never writes after it. */
  private cycle = 0;
  private open = false;

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
    let wallet = this.store.liveWallet;
    void this.refresh();
    const stopFollowing = this.store.subscribe(() => {
      if (this.store.liveWallet === wallet) return;
      wallet = this.store.liveWallet;
      void this.refresh();
    });
    const timer = setInterval(() => {
      if (!isHidden()) void this.refresh();
    }, WALLET_READ_EVERY_MS);
    return () => {
      this.open = false;
      this.cycle += 1;
      clearInterval(timer);
      stopFollowing();
      this.set(IDLE);
    };
  }

  /** Reads the connected wallet's stake and delegations behind its earlier work; another account's figures go at once. */
  async refresh(): Promise<void> {
    if (!this.open) return;
    const wallet = this.store.liveWallet;
    const account = wallet?.address ?? null;
    if (account !== this.state.account) {
      this.cycle += 1;
      this.set({ account, read: LOADING });
    }
    const staking = wallet?.staking;
    if (wallet === null || staking === undefined || wallet.readOnly === true) {
      this.set({ read: NONE });
      return;
    }
    const cycle = this.cycle;
    try {
      const read = await this.store.monkeySession.walletWork.work(wallet, () => staking.delegations());
      if (cycle === this.cycle && this.open) this.set({ read: ready(read) });
    } catch (error) {
      if (cycle === this.cycle && this.open) this.set({ read: failed(error, this.state.read.value) });
    }
  }
}
