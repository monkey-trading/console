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
  /** Unavailable for a wallet with no staking calls, or a build that names no staking contract. */
  read: Read<StakeDelegations>;
  /** Whether a staking transaction has landed and no read begun since has succeeded: the figures held are the ones before it. */
  settling: boolean;
}

/** A wallet with no staking calls, such as a watched account's, reads nothing. */
const NONE = { status: "unavailable", value: null, message: null } as const;
const IDLE: DelegationsState = { account: null, read: LOADING, settling: false };

/**
 * Whether the connected account's own reads have each given an answer, a failure or "unavailable"
 * included, so a card laid out from them can be shown without growing when they land: the wallet
 * decided, and — for a wallet that reads — this account's delegations and its stake position.
 * `position` is the stake card's read status for this account ("ready" where it is not waited for).
 */
export function accountReadsSettled({ wallet, decided, delegations, position }: { wallet: { address: string; readOnly?: boolean } | null; decided: boolean; delegations: DelegationsState; position: Read<unknown>["status"] }): boolean {
  if (wallet === null) return decided;
  if (wallet.readOnly === true) return true;
  return delegations.account === wallet.address && delegations.read.status !== "loading" && position !== "loading";
}

export class DelegationReads {
  private state: DelegationsState = IDLE;
  private readonly listeners = new Set<() => void>();
  /** Counts openings and wallet changes; a read begun before one never writes after it. */
  private cycle = 0;
  private open = false;
  /** The read waiting for a wallet, which another ask for that wallet joins until it has begun asking, so reads never pile up behind a wallet that is slow to answer. */
  private reading: { wallet: Wallet; cycle: number; read: Promise<void>; started: boolean } | null = null;
  /** Spaces the timer's reads out after failures; a read asked for after a transaction is not held back. */
  private readonly backoff = new Backoff();
  /**
   * Counts landed transactions, and the count the last successful read began after: while they
   * differ, the figures held predate a landed change. Another account's figures, or a new opening,
   * start level.
   */
  private landed = 0;
  private caughtUp = 0;

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

  /**
   * Starts the reads, and returns what stops them. What they read stays for the account it was read
   * for, so a tab return keeps the rows and editors that read laid out (monkey-trading/console#329),
   * but counts as a change nobody observed: it stays settling, its forms shut, until a read begun
   * after the restart succeeds. Another account's stays until the first read replaces it, and no
   * consumer takes it for its own; a read that holds no figures is forgotten.
   * While `isHidden` says the tab is hidden the timer reads nothing.
   */
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
      if (this.state.read.value === null) {
        this.caughtUp = this.landed;
        this.set(IDLE);
      } else {
        this.landed += 1;
        this.set({ settling: true });
      }
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
      this.caughtUp = this.landed;
      this.set({ account, read: LOADING, settling: false });
    }
    const staking = wallet?.staking;
    if (wallet === null || staking === undefined || wallet.readOnly === true) {
      this.set({ read: NONE });
      return Promise.resolve();
    }
    const cycle = this.cycle;
    const waiting = this.reading;
    if (waiting !== null && waiting.wallet === wallet && waiting.cycle === cycle && !waiting.started) return waiting.read;
    const current = () => cycle === this.cycle && this.open && this.store.liveWallet === wallet;
    const entry = { wallet, cycle, read: Promise.resolve(), started: false };
    entry.read = this.store.monkeySession.walletWork.work(wallet, async () => {
      entry.started = true;
      if (!current()) return;
      // Begun after every transaction landed so far, so a success reflects them all.
      const after = this.landed;
      try {
        const answer = await staking.delegations();
        this.backoff.record(false);
        if (current()) {
          this.caughtUp = Math.max(this.caughtUp, after);
          this.set({ read: answer === null ? NONE : ready(answer), settling: this.landed > this.caughtUp });
        }
      } catch (error) {
        this.backoff.record(true);
        if (current()) this.set({ read: failed(error, this.state.read.value) });
      }
    }).finally(() => {
      if (this.reading === entry) this.reading = null;
    });
    this.reading = entry;
    return entry.read;
  }

  /**
   * After a staking transaction landed: the figures held are the ones before it until a read begun
   * after it succeeds, so the forms that check against them stay shut till then; a failed read leaves
   * them shut, and the timer's next read may open them. Resolves once this read has finished.
   */
  async settleAfter(): Promise<void> {
    if (!this.open) return;
    this.landed += 1;
    this.set({ settling: true });
    await this.refresh();
  }
}
