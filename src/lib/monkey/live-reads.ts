/**
 * What keeps the MONKEY page current without a button (monkey-trading/console#202): which events on
 * the signed stream change a figure, a limiter that re-reads at most once a second per read, and
 * the backoff a failing read waits out by itself.
 */

import type { StreamMessage } from "../engine/types";

/** How often the wallet's chain reads repeat while the page is on screen and its tab visible, in milliseconds. */
export const WALLET_READ_EVERY_MS = 15_000;
/** The shortest wait between two event-driven reads of one kind. */
export const EVENT_READ_MS = 1_000;
/** A failing read waits this long, doubled for each failure in a row, up to the cap. */
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_CAP_MS = 120_000;

/** The stream's names for what changes a MONKEY figure: a stake, an unstake, a delegation, an election, an epoch closing, a distribution, an emission allocation or period, a deposit, a claim, a registered or revoked key, a posted checkpoint. */
const CHANGES = /stak|deleg|elect|epoch|distribut|emission|deposit|custody|claim|session_key|checkpoint/;
/** Commands that only report the chain's progress, such as `staking_progress` and `custody_finalised`, which run about once a second: their name says nothing changed, only what they carry does. */
const PROGRESS = /progress|finalised|finalized|heartbeat/;
/** The events that change figures of every account, so a connected wallet's own are read again whoever they name. */
const EVERYONE = /epoch|distribut|emission_period|checkpoint|elect|rotation/;

/** What a message on the stream asks the page to read again. */
export interface Rereads {
  /** The node's totals and activity. */
  node: boolean;
  /** The connected wallet's chain reads and the node's proofs for it. */
  wallet: boolean;
}

/** The reads `message` calls for, for the account `account` (lowercase) that is connected, if any. */
export function rereadsFor(message: StreamMessage, account: string | null): Rereads {
  const names = [...(PROGRESS.test(message.cmd.type) ? [] : [message.cmd.type]), ...message.events.map((event) => event.type)];
  if (!names.some((name) => CHANGES.test(name))) return { node: false, wallet: false };
  const mine = message.events.some((event) => "account" in event && typeof event.account === "string" && event.account.toLowerCase() === account);
  return { node: true, wallet: account !== null && (mine || names.some((name) => EVERYONE.test(name))) };
}

/** `run` at most once in `ms`: the first call runs at once, calls within the wait are folded into one run at its end. */
export class Limiter {
  private last = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly run: () => void, private readonly ms: number, private readonly now: () => number = Date.now) {}

  call(): void {
    if (this.timer !== null) return;
    const wait = this.last + this.ms - this.now();
    if (wait <= 0) {
      this.last = this.now();
      this.run();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.last = this.now();
      this.run();
    }, wait);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** How long a read that has failed `failures` times in a row waits before the next try. */
export const backoffMs = (failures: number): number => (failures <= 0 ? 0 : Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (failures - 1)));

/** The backoff of one kind of read: it records each answer, and says when the timer may try again. */
export class Backoff {
  private failures = 0;
  private notBefore = 0;

  /** Notes how a read ended; a failure pushes the next try out, a success clears it. */
  record(failed: boolean, now = Date.now()): void {
    this.failures = failed ? this.failures + 1 : 0;
    this.notBefore = now + backoffMs(this.failures);
  }

  ready(now = Date.now()): boolean {
    return now >= this.notBefore;
  }

  reset(): void {
    this.failures = 0;
    this.notBefore = 0;
  }
}

/** What `followLive` needs from the page. */
export interface LiveDeps {
  isHidden(): boolean;
  /** Whether the page is open: a stopped page reads nothing. */
  open(): boolean;
  /** The connected account, lowercase, or null. */
  account(): string | null;
  subscribe(onMessage: (message: StreamMessage) => void): () => void;
  readNode(): void;
  readWallet(): void;
  /** Whether each kind of read is past its backoff, and whether the node route is worth asking again. */
  nodeDue(): boolean;
  walletDue(): boolean;
  /** One tick of the page's charts. */
  tickCharts(): void;
  /**
   * A claim proof is awaited: an epoch or period paid that the account may share in, and the node
   * holds no proof for it yet, because the vault has not accepted a checkpoint covering it. While
   * it is, `readProofs` runs on every tick and on every signed checkpoint the stream carries
   * (`watchCheckpoints`: checkpoints are frames of their own, not commands, so `rereadsFor` never sees them).
   */
  awaitingProof?(): boolean;
  readProofs?(): void;
  watchCheckpoints?(onCheckpoint: () => void): () => void;
  /** The base tick, the node's slower read and the wallet's, in milliseconds. */
  tickMs: number;
  nodeEveryMs: number;
}

/**
 * The page's timer and its stream: the charts every tick, the node's totals and the wallet's chain
 * reads on their own slower timers, each only while the tab shows and not before its backoff has
 * passed; and an event on the signed stream that changes a figure re-reads it at once, at most
 * once a second per read. Returns what stops all of it.
 */
export function followLive(deps: LiveDeps): () => void {
  let ticks = 0;
  const timer = setInterval(() => {
    if (deps.isHidden()) return;
    ticks += 1;
    if (ticks % (deps.nodeEveryMs / deps.tickMs) === 0 && deps.nodeDue()) deps.readNode();
    if (ticks % (WALLET_READ_EVERY_MS / deps.tickMs) === 0 && deps.account() !== null && deps.walletDue()) deps.readWallet();
    if (deps.account() !== null && deps.awaitingProof?.() === true) deps.readProofs?.();
    deps.tickCharts();
  }, deps.tickMs);
  const node = new Limiter(deps.readNode, EVENT_READ_MS);
  const wallet = new Limiter(deps.readWallet, EVENT_READ_MS);
  const unsubscribe = deps.subscribe((message) => {
    if (deps.isHidden() || !deps.open()) return;
    const reads = rereadsFor(message, deps.account());
    if (reads.node) node.call();
    if (reads.wallet) wallet.call();
  });
  const proofs = new Limiter(() => deps.readProofs?.(), EVENT_READ_MS);
  const unwatch = deps.watchCheckpoints?.(() => {
    if (deps.isHidden() || !deps.open() || deps.account() === null || deps.awaitingProof?.() !== true) return;
    proofs.call();
  });
  return () => {
    clearInterval(timer);
    unsubscribe();
    unwatch?.();
    node.cancel();
    wallet.cancel();
    proofs.cancel();
  };
}
