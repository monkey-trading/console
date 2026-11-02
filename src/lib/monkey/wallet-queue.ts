/**
 * The wallet's provider work, queued so it is asked one thing at a time: the page's chain reads and
 * every transaction the page sends. The queue belongs to the session, not to a page opening, so
 * leaving the page and coming back does not start reads beside work still in flight. Work for
 * another wallet has its own provider and does not wait.
 */

import type { Wallet } from "../engine/wallet";
import type { MonkeyPanel } from "./panel";

interface Entry {
  /** Whether it is a page read rather than a transaction. */
  read: boolean;
  started: boolean;
  settled: boolean;
  /** Which opening of the page queued it; only the same opening's reads serve each other. */
  tag: number;
  /** Settles when the work has, whether it succeeded or not. */
  done: Promise<void>;
}

export class WalletQueue {
  private readonly latest = new WeakMap<Wallet, Entry>();
  /** The wallets with a transaction waiting or running, whatever has been queued behind it. */
  private readonly sending = new WeakSet<Wallet>();

  /**
   * Queues a read of `wallet`. A read already queued or running for it serves this one too, unless
   * `fresh` asks for one that starts after the running one, which a transaction needs: a read that
   * has not started yet always serves, since it will sample after anything now running. `tag`
   * names the page opening, whose reads serve only each other.
   */
  read(wallet: Wallet, fresh: boolean, tag: number, task: () => Promise<void>): Promise<void> {
    const running = this.latest.get(wallet);
    if (running !== undefined && running.read && running.tag === tag && !running.settled && (!fresh || !running.started)) return running.done;
    return this.enqueue(wallet, true, tag, task);
  }

  /**
   * Queues a transaction for `wallet` behind its earlier work, or resolves null without running
   * `task` when another transaction is already waiting or running for it, so a repeated click does
   * not queue a second one. A rejection reaches the caller and does not stop the queue.
   */
  transaction<T>(wallet: Wallet, task: () => Promise<T>): Promise<T | null> {
    if (this.sending.has(wallet)) return Promise.resolve(null);
    this.sending.add(wallet);
    return this.enqueue(wallet, false, 0, async () => {
      try {
        return await task();
      } finally {
        this.sending.delete(wallet);
      }
    });
  }

  /** Queues any other call to `wallet`'s provider behind its earlier work, as a read or a transaction is, without the transaction rule of one at a time. */
  work<T>(wallet: Wallet, task: () => Promise<T>): Promise<T> {
    return this.enqueue(wallet, false, 0, task);
  }

  private enqueue<T>(wallet: Wallet, read: boolean, tag: number, task: () => Promise<T>): Promise<T> {
    const prior = this.latest.get(wallet)?.done ?? Promise.resolve();
    const entry: Entry = { read, tag, started: false, settled: false, done: Promise.resolve() };
    const done = prior.then(async () => {
      entry.started = true;
      try {
        return await task();
      } finally {
        // Before the caller hears of it, so a read asked for straight after never joins one that has finished.
        entry.settled = true;
      }
    });
    // What the next caller waits for settles whether the task did or not.
    entry.done = done.then(() => undefined, () => undefined);
    this.latest.set(wallet, entry);
    return done;
  }
}

/** What the MONKEY page keeps for the whole session: the wallet queue, and the page's store while the page is on screen, which a transaction that lands later refreshes. */
export class MonkeySession {
  readonly walletWork = new WalletQueue();
  private openings = 0;
  /** A number no other opening of the page, in any panel instance, has been given. */
  nextOpening(): number {
    this.openings += 1;
    return this.openings;
  }
  panel: MonkeyPanel | null = null;
}
