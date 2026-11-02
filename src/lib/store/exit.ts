/**
 * Keeps the connected account's exit proof at the vault's latest posted root
 * (monkey-trading/console#36), so the account can leave through the vault with no node at all.
 *
 * The node signs every answer, so it is read only when the vault is seen to hold a new root
 * (`exit-keeper.ts`), and not at all for an account with nothing at stake. The vault's reads go
 * through the wallet's provider: when a wallet connects, soon after the stream carries a new
 * checkpoint, when the feed stops, when the tab is seen again, and otherwise every five minutes while
 * the tab is visible. A read that fails is made again by itself, further apart each time, and nobody
 * has to press anything for it.
 */

import type { Unsubscribe } from "../engine/client";
import type { ExitWallet } from "../engine/exit-types";
import type { Scheduler } from "../engine/live-stream";
import type { Wallet } from "../engine/wallet";
import { ExitKeeper } from "./exit-keeper";
import { NO_EXIT, nodeWait, readFailed, stakeKey, type ExitResult, type ExitState } from "./exit-state";
import { errorText } from "./signing";
import type { ConsoleStore } from "./store";

/** How often the vault is read with no other reason to, while the tab is visible, in milliseconds. */
export const SLOW_READ_MS = 5 * 60_000;
/** How long to wait before each read of the vault after the stream carries a checkpoint, until it holds that checkpoint, in milliseconds; a post takes a block or two. */
export const CHASE_MS: readonly number[] = [3_000, 8_000, 20_000, 45_000, 90_000, 180_000];
/** How long to wait before each read after one that failed, in milliseconds; the last repeats while the tab is visible and the read still fails. */
export const RETRY_MS: readonly number[] = [5_000, 15_000, 45_000, 120_000, SLOW_READ_MS];
/** How long a read of the vault serves a tab that is seen again, in milliseconds. */
const RECENT_MS = 30_000;

export interface ExitFollowDeps {
  scheduler: Scheduler;
  /** Whether the tab is hidden, when the slow read does not run. */
  hidden(): boolean;
  nowMs(): number;
}

export class ExitWatch {
  readonly keeper: ExitKeeper;
  private wallet: Wallet | null = null;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private refreshOwed = false;
  private lastKey = "";
  private ready = false;
  private lastReadMs = 0;
  /** What `follow` was given; null while nothing follows, as in a store a test drives by hand. */
  private deps: ExitFollowDeps | null = null;
  /** The timer of the checkpoint being chased. */
  private chasing: unknown = null;
  /** The timer of the next read after one that failed. */
  private retrying: unknown = null;
  /** How many of those have run since a read last answered. */
  private retries = 0;

  constructor(private readonly store: ConsoleStore) {
    this.keeper = new ExitKeeper(store);
  }

  private patch(partial: Partial<ExitState>): void {
    this.store.patch({ exit: { ...this.store.getSnapshot().exit, ...partial } });
  }

  /** Follows the wallet, the stream and the clock until the returned stop is called. */
  follow(deps: ExitFollowDeps): () => void {
    const { store } = this;
    this.deps = deps;
    const stopStore = store.subscribe(() => this.sync());
    const stopClient: Unsubscribe = store.deps.client.watch((event) => {
      if (event.type === "checkpoint") this.chase(event.seq, 0);
      else if (event.type === "feed" && event.status === "stale" && !this.standingDown()) void this.refresh();
    });
    let timer: unknown = null;
    const slow = () => {
      timer = deps.scheduler.setTimeout(slow, SLOW_READ_MS);
      if (!deps.hidden()) void this.refresh();
    };
    timer = deps.scheduler.setTimeout(slow, SLOW_READ_MS);
    this.sync();
    return () => {
      stopStore();
      stopClient();
      deps.scheduler.clearTimeout(timer);
      if (this.chasing !== null) deps.scheduler.clearTimeout(this.chasing);
      this.chasing = null;
      this.stopRetry();
      this.wallet = null;
      this.deps = null;
    };
  }

  /** Reads the vault at each of `CHASE_MS` until it holds the checkpoint at `seq`. */
  private chase(seq: number, step: number): void {
    const { deps } = this;
    if (deps === null) return;
    if (this.chasing !== null) deps.scheduler.clearTimeout(this.chasing);
    this.chasing = null;
    const delay = CHASE_MS[step];
    if (delay === undefined) return;
    this.chasing = deps.scheduler.setTimeout(() => {
      this.chasing = null;
      // Reads that are failing go at the retry's pace, not the chase's, and a hidden tab makes none.
      if (readFailed(this.store.getSnapshot().exit)) return;
      void this.refresh().then(() => {
        const { exit } = this.store.getSnapshot();
        if (!readFailed(exit) && (exit.vault?.latestSeq ?? 0) < seq) this.chase(seq, step + 1);
      });
    }, delay);
  }

  /** Whether reads have been failing in a hidden tab, which makes no more of them: its next comes once it is seen. */
  private standingDown(): boolean {
    return this.deps?.hidden() === true && readFailed(this.store.getSnapshot().exit);
  }

  private stopRetry(): void {
    if (this.retrying !== null) this.deps?.scheduler.clearTimeout(this.retrying);
    this.retrying = null;
  }

  /** A read that failed is made again by itself, further apart each time; a hidden tab makes none, and its next comes once it is seen. */
  private paceRetry(): void {
    const { deps } = this;
    if (deps === null) return;
    const failed = readFailed(this.store.getSnapshot().exit);
    if (!failed) this.retries = 0;
    if (!failed || deps.hidden()) return this.stopRetry();
    if (this.retrying !== null) return;
    this.retrying = deps.scheduler.setTimeout(() => {
      this.retrying = null;
      this.retries += 1;
      if (deps.hidden()) return;
      this.keeper.retryNode();
      void this.refresh();
    }, RETRY_MS[Math.min(this.retries, RETRY_MS.length - 1)] ?? SLOW_READ_MS);
  }

  /** Heard on every store change, so it costs little unless the wallet, the node's state or the stake moved. */
  private sync(): void {
    const wallet = this.store.liveWallet;
    const state = this.store.getSnapshot();
    if (wallet !== this.wallet) {
      this.wallet = wallet;
      this.keeper.reset();
      this.stopRetry();
      this.retries = 0;
      this.refreshOwed = false;
      this.lastKey = "";
      const scope = this.keeper.scope(wallet);
      this.patch({ ...NO_EXIT, ...this.keeper.startingFrom(scope) });
      if (scope !== null) void this.refresh();
      return;
    }
    if (wallet?.exit === undefined) return;
    this.paceRetry();
    if (this.refreshOwed && state.prompt === null) void this.refresh();
    const wait = nodeWait(state.attestation, state.stream);
    const ready = wait === "ready";
    if (ready && !this.ready) this.keeper.forgetTried(); // a node back from away may answer what it could not
    this.ready = ready;
    const key = `${typeof wait === "string" ? wait : "away"}|${state.accountRead}|${stakeKey(state)}`;
    if (key === this.lastKey || state.exit.vault === null) return;
    this.lastKey = key;
    void this.keeper.settle();
  }

  /** Reads the vault through the wallet and acts on what it says. A wallet prompt holds the provider, so the read waits for that. */
  refresh(): Promise<void> {
    const wallet = this.store.liveWallet;
    const exit = wallet?.exit;
    if (wallet === null || exit === undefined) return Promise.resolve();
    if (this.store.getSnapshot().prompt !== null) {
      this.refreshOwed = true;
      return Promise.resolve();
    }
    if (this.refreshing !== null) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshOwed = false;
    this.lastReadMs = this.deps?.nowMs() ?? this.lastReadMs;
    this.refreshing = this.readVault(wallet, exit).finally(() => {
      this.refreshing = null;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        void this.refresh();
      }
    });
    return this.refreshing;
  }

  /** The tab was seen again: reads the vault, unless it was read just now. */
  seen(): void {
    if (this.deps !== null && this.deps.nowMs() - this.lastReadMs >= RECENT_MS) void this.refresh();
    this.paceRetry();
  }

  private async readVault(wallet: Wallet, exit: ExitWallet): Promise<void> {
    try {
      const vault = await this.store.monkeySession.walletWork.work(wallet, () => exit.facts());
      if (this.store.liveWallet !== wallet) return;
      this.patch({ vault, vaultProblem: null, vaultFailures: 0 });
    } catch (error) {
      if (this.store.liveWallet === wallet) this.patch({ vaultProblem: errorText(error), vaultFailures: this.store.getSnapshot().exit.vaultFailures + 1 });
      return;
    }
    await this.keeper.retryAnswer();
    await this.keeper.settle();
    await this.readClaims();
  }

  /** Reads what the vault holds for the account once the exit has started; the page shows why a read failed. False when it failed, so nothing is sent on what it held before. */
  async readClaims(): Promise<boolean> {
    const wallet = this.store.liveWallet;
    const { vault, record } = this.store.getSnapshot().exit;
    const exit = wallet?.exit;
    if (wallet === null || exit === undefined || vault === null || vault.exitStartedAt === 0) return false;
    // A proof at another root registers nothing, but what is registered already can be paid without one.
    const proof = record?.proof.root === vault.latestRoot ? record.proof : null;
    try {
      const claims = await this.store.monkeySession.walletWork.work(wallet, () => exit.claims(proof));
      if (this.store.liveWallet !== wallet) return false;
      this.patch({ claims, claimsProblem: null, claimsFailures: 0 });
      return true;
    } catch (error) {
      if (this.store.liveWallet === wallet) this.patch({ claimsProblem: errorText(error), claimsFailures: this.store.getSnapshot().exit.claimsFailures + 1 });
      return false;
    }
  }

  /** What the panel says of the last import or action, until the next replaces it, and, for an import, whether its file is being read. */
  note(result: ExitResult, reading?: boolean): void {
    if (result === null) this.store.clearNotice("exit");
    else this.store.notify("exit", result.text, result.ok ? "info" : "error");
    if (reading !== undefined) this.patch({ reading });
  }

  /** What a screen reader is told of an action the panel shows by itself. One the same as the last would change nothing in the live region and go unread, so it differs by a space a screen reader does not speak. */
  announce(text: string): void {
    this.patch({ announced: this.store.getSnapshot().exit.announced === text ? `${text}\u00a0` : text });
  }

  /** What the vault paid this page's claim, for the card to say. */
  notePaid(paid: bigint | null): void {
    this.patch({ paid });
  }

  /** Reads the vault afresh, and says whether it answered: what an action needs before it sends anything. */
  async readFresh(): Promise<boolean> {
    await this.refresh();
    return this.store.getSnapshot().exit.vaultProblem === null;
  }
}
