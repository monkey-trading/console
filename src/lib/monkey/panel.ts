/**
 * The MONKEY page's reads (monkey-trading/console#202). It is a store of its own, opened only while the
 * page is on screen and its tab visible: the node's totals and activity every 30 seconds, every chart
 * every 5, the wallet's chain reads every 15 (one at a time, bounded, never asking the wallet to do
 * anything) and after a transaction, and each straight away, at most once a second, on a stream event
 * that changes it (`live-reads.ts`). A failing read backs off and shows calmly on its panel, with no
 * no button; the vault's MONKEY record, read with the wallet's, is unread after a failure, which the
 * emissions card says.
 */

import { carryAccrued } from "../engine/claim-standing";
import { withTimeout } from "../engine/provider-errors";
import type { ActivityPage, DistributionProof, MonkeyView } from "../engine/stats-types";
import type { StakingPosition } from "../engine/staking";
import type { Wallet } from "../engine/wallet";
import { checkEmissionsClaimed } from "../store/emissions";
import type { ConsoleStore } from "../store/store";
import { ChartFeed } from "./feed";
import { failed, LOADING, ready, type Read } from "./figures";
import { Backoff, followLive } from "./live-reads";
import { proofAwaited, readEntitlement } from "./pending";

/** The activity table's length, and how often the page's totals and activity are read, in milliseconds. */
export const ACTIVITY_LIMIT = 25;
export const NODE_READ_MS = 30_000;
/** The page's one timer: the charts' cadence, and the unit the slower reads count in. */
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

/** The text typed in the stake and unstake fields, for the account it was typed for. */
export interface Drafts { account: string | null; stake: string; unstake: string }

const NO_DRAFTS: Drafts = { account: null, stake: "", unstake: "" };

export interface PanelState {
  overview: Read<MonkeyView>;
  activity: Read<ActivityPage>;
  wallet: WalletFigures;
  /**
   * Set after a transaction that changed the account's counted stake (a stake, a completed unstake),
   * to the node's total as it stood: the node mirrors the chain a little later, so until its total
   * moves, the wallet and the total disagree and a share of one in the other would be wrong.
   */
  unmirroredTotal: string | null;
  /**
   * Held here, not in the fields, so a gap in the feed (the stop clears the wallet figures and the
   * forms with them) loses nothing a visitor typed; another account's, or none, clears them.
   */
  drafts: Drafts;
  /** True from the moment a transaction lands until the wallet has been read again, so a stale balance or Max cannot be sent again. */
  settling: boolean;
}

const NO_WALLET: WalletFigures = { address: null, position: LOADING, proof: LOADING };

export class MonkeyPanel {
  readonly feeds: Record<"epochs" | "perLoss" | "supply" | "rewards", ChartFeed>;
  private state: PanelState = { overview: LOADING, activity: LOADING, wallet: NO_WALLET, unmirroredTotal: null, drafts: NO_DRAFTS, settling: false };
  /** Landed transactions whose re-read is still running. */
  private settlers = 0;
  private proofReads = 0;
  private proofLanded = 0;
  private readonly listeners = new Set<() => void>();
  private nodeRead: Promise<void> | null = null;
  private readonly nodeBackoff = new Backoff();
  private readonly walletBackoff = new Backoff();
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
    const stopLive = followLive({
      isHidden, open: () => this.open, account: () => this.store.liveWallet?.address.toLowerCase() ?? null,
      subscribe: (onMessage) => this.store.deps.client.subscribe(onMessage),
      readNode: () => void this.refreshNode(), readWallet: () => void this.refreshWallet(),
      // A node that predates both routes is not asked again until the page is reopened.
      nodeDue: () => this.nodeBackoff.ready() && !(this.state.overview.status === "unavailable" && this.state.activity.status === "unavailable"),
      walletDue: () => this.walletBackoff.ready(),
      tickCharts: () => { for (const feed of Object.values(this.feeds)) void feed.tickLive(); },
      awaitingProof: () => this.store.liveWallet !== null && proofAwaited({ ...this.state, ...this.state.wallet, account: this.store.liveWallet.address, entitlement: this.store.getSnapshot().entitlement, proof: this.state.wallet.proof, position: this.state.wallet.position }),
      readProofs: () => { const wallet = this.store.liveWallet; if (wallet !== null) void this.readProof(wallet, this.cycle); void readEntitlement(this.store, () => this.open); },
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
      for (const feed of Object.values(this.feeds)) feed.close();
      this.set({ overview: LOADING, activity: LOADING, wallet: NO_WALLET, unmirroredTotal: null, settling: false });
    };
  }

  /** Marks the stake figures as ahead of the node's mirror until its total moves; see [PanelState.unmirroredTotal]. */
  holdShare(): void {
    this.set({ unmirroredTotal: this.state.overview.value?.staking?.total_staked ?? "" });
  }

  /** Keeps what was typed in a field; the field's account is the connected one. */
  setDraft(field: "stake" | "unstake", text: string): void {
    const account = this.store.liveWallet?.address ?? null;
    this.set({ drafts: { ...(this.state.drafts.account === account ? this.state.drafts : NO_DRAFTS), account, [field]: text } });
  }

  /** Empties a field once what was sent from it has landed, unless the visitor has typed something else since. */
  clearDraft(field: "stake" | "unstake", sent: string): void {
    if (this.state.drafts[field] === sent) this.set({ drafts: { ...this.state.drafts, [field]: "" } });
  }

  /** Marks a landed transaction's re-read as running; `reread` is that read, after which the forms open again. */
  async settle(reread: Promise<unknown>): Promise<void> {
    const cycle = this.cycle;
    this.settlers += 1;
    this.set({ settling: true });
    await reread.finally(() => {
      if (cycle !== this.cycle) return; // the page was reopened meanwhile, which reset the count
      this.settlers -= 1;
      this.set({ settling: this.settlers > 0 });
    });
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
      this.nodeBackoff.record(overview.status === "rejected" || activity.status === "rejected");
      const held = this.state.unmirroredTotal;
      const mirrored = overview.status === "fulfilled" && (overview.value.staking?.total_staked ?? "") !== held;
      this.set({
        unmirroredTotal: mirrored ? null : held,
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
      this.set({ wallet: NO_WALLET, drafts: NO_DRAFTS });
      return Promise.resolve();
    }
    const cycle = this.cycle;
    if (this.state.wallet.address !== wallet.address) this.set({ wallet: { ...NO_WALLET, address: wallet.address }, unmirroredTotal: null });
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
    return Promise.all([proof, chain]).then(() => {
      this.walletBackoff.record(this.state.wallet.position.status === "failed" || this.state.wallet.proof.status === "failed");
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
      } catch {
        // The wallet did not answer in time. The emissions card says the vault's record is unread, and the next wallet read asks again.
      }
    }
    await Promise.all(outstanding);
  }
}

/** How long the wallet's reads may take before a read fails into its figures, in milliseconds. */
const WALLET_READ_MS = 30_000;
