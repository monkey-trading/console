/**
 * The operator card's reads. The node's signed `GET /v1/operator` is read at the page's 30-second
 * pace; the registry's reads go through the connected wallet, one call at a time behind the wallet's
 * other work, on open, when the wallet changes, on an election event in the stream, after a
 * delegation, on the visitor's Refresh, and otherwise every five minutes while the tab is visible,
 * since each read costs the wallet's provider money.
 */

import { readBlock } from "../engine/attestation";
import { hostnameOrigin, listedOrigins, type Deploy } from "../engine/deploy";
import type { CandidateTable, NamedOperator } from "../engine/registry";
import type { OperatorRoute } from "../engine/stats-types";
import type { Wallet } from "../engine/wallet";
import type { ConsoleStore } from "../store/store";
import { failed, LOADING, ready, type Read } from "./figures";
import { NODE_READ_MS, WALLET_READ_MS, withTimeout } from "./panel";

/** The registry's slow read, as a count of the node read's ticks: five minutes. */
const CHAIN_READ_TICKS = 10;

/** A read that has no chain to go through. */
const NO_CHAIN = { status: "unavailable", value: null, message: null } as const;

export interface OperatorsState {
  /** What the node's log mirrors. */
  route: Read<OperatorRoute>;
  /** The operator the vault names, from the registry; null from a build that names no registry. */
  named: Read<NamedOperator | null>;
  table: Read<CandidateTable | null>;
  /** The candidate the connected account's whole stake votes for; null while it abstains. */
  chosen: Read<string | null>;
}

const NOTHING_READ: OperatorsState = { route: LOADING, named: LOADING, table: LOADING, chosen: LOADING };

/** A hostname as the page shows it: plain ASCII as the build could connect to it, or null for text it could not, so a lookalike in another script never reads as a host. */
export function shownHostname(hostname: string | null): string | null {
  return hostname !== null && hostnameOrigin(hostname) !== null ? hostname.toLowerCase() : null;
}

/** Whether this build could connect to `hostname`: its CSP names the origin. */
export function hostnameListed(deploy: Pick<Deploy, "origin" | "candidateOrigins">, hostname: string): boolean {
  const origin = hostnameOrigin(hostname);
  return origin !== null && listedOrigins(deploy).includes(origin);
}

/** An election the log mirrors and has not applied: what the page shows of a pending election with no chain to read. */
export function mirroredElection(route: OperatorRoute | null, nowMs: number): { candidate: string; effectiveAtMs: number } | null {
  const election = route?.last_election ?? null;
  // A clock of zero is one no frame has set yet, against which any election would look ahead.
  if (election === null || election.cancelled === true || nowMs <= 0 || election.effective_at <= nowMs) return null;
  return { candidate: election.candidate, effectiveAtMs: election.effective_at };
}

export class OperatorReads {
  private state: OperatorsState = NOTHING_READ;
  private readonly listeners = new Set<() => void>();
  /** Counts the card's openings; work begun in an earlier one never writes into a later one. */
  private cycle = 0;
  private open = false;
  /** The wallet the registry was last read through, so a page opening does not read twice for one wallet. */
  private readFor: Wallet | null = null;
  /** The registry read waiting or running for a wallet, which a second ask for that wallet joins: each costs dozens of calls. */
  private chainRead: { wallet: Wallet; read: Promise<void> } | null = null;

  constructor(private readonly store: ConsoleStore) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): OperatorsState => this.state;

  private set(partial: Partial<OperatorsState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  /** Whether the node's answers may be read now. */
  private nodeReadable(): boolean {
    return readBlock(this.store.getSnapshot().attestation, "live") === null;
  }

  /** Starts the reads, and returns what stops them and forgets what they read. While `isHidden` says the tab is hidden the timer reads nothing. */
  start(isHidden: () => boolean): () => void {
    this.open = true;
    this.cycle += 1;
    void this.refreshNode();
    void this.refreshChain();
    // No figure from a node the console has stopped trusting stays on the card, and a node trusted again is read at once.
    let readable = this.nodeReadable();
    const stopFollowing = this.store.subscribe(() => {
      const now = this.nodeReadable();
      if (now === readable) return;
      readable = now;
      if (now) void this.refreshNode();
      else this.set({ route: LOADING });
    });
    let ticks = 0;
    const timer = setInterval(() => {
      if (isHidden()) return;
      ticks += 1;
      if (this.state.route.status !== "unavailable") void this.refreshNode();
      if (ticks % CHAIN_READ_TICKS === 0) void this.refreshChain();
    }, NODE_READ_MS);
    const unsubscribe = this.store.deps.client.subscribe((message) => {
      if (!message.events.some((event) => event.type === "operator_elected" || event.type === "rotation_switched")) return;
      void this.refreshNode();
      void this.refreshChain();
    });
    return () => {
      this.open = false;
      this.cycle += 1;
      clearInterval(timer);
      unsubscribe();
      stopFollowing();
      this.readFor = null;
      this.chainRead = null;
      this.set(NOTHING_READ);
    };
  }

  /** Reads the node's route, while its answers may be read: the registry's reads need nothing from it. */
  async refreshNode(): Promise<void> {
    if (!this.nodeReadable()) return;
    const cycle = this.cycle;
    try {
      const route = await this.store.deps.client.stats.operator();
      if (cycle === this.cycle && this.open) this.set({ route: ready(route) });
    } catch (error) {
      if (cycle === this.cycle && this.open) this.set({ route: failed(error, this.state.route.value) });
    }
  }

  /** Reads the registry if the connected wallet is not the one it was last read through. */
  walletChanged(): void {
    if (this.store.liveWallet !== this.readFor) void this.refreshChain();
  }

  /**
   * Reads the registry through the connected wallet, behind the wallet's earlier work; with no wallet
   * that reads a chain there is nothing to read. A read waiting or running for this wallet serves this
   * one too: it ran or will run after anything already done, a transaction included, since those
   * share its queue. Another wallet's figures go at once, and its read stands aside.
   */
  refreshChain(): Promise<void> {
    const wallet = this.store.liveWallet;
    if (wallet !== this.readFor) this.set({ named: LOADING, table: LOADING, chosen: LOADING });
    this.readFor = wallet;
    if (wallet === null || wallet.chainReads === undefined) {
      this.set({ named: NO_CHAIN, table: NO_CHAIN, chosen: NO_CHAIN });
      return Promise.resolve();
    }
    if (this.chainRead?.wallet === wallet) return this.chainRead.read;
    const read = this.store.monkeySession.walletWork.work(wallet, () => this.readChain(wallet)).finally(() => {
      if (this.chainRead?.read === read) this.chainRead = null;
    });
    this.chainRead = { wallet, read };
    return read;
  }

  private async readChain(wallet: Wallet): Promise<void> {
    const cycle = this.cycle;
    const reads = wallet.chainReads;
    const current = () => this.open && cycle === this.cycle && this.store.liveWallet === wallet;
    if (reads === undefined || !current()) return;
    try {
      const named = await withTimeout(reads.operator(), WALLET_READ_MS);
      if (current()) this.set({ named: ready(named) });
    } catch (error) {
      if (current()) this.set({ named: failed(error, this.state.named.value) });
    }
    if (!current()) return;
    try {
      const table = await withTimeout(reads.candidates(), WALLET_READ_MS);
      if (current()) this.set({ table: ready(table) });
    } catch (error) {
      if (current()) this.set({ table: failed(error, this.state.table.value) });
    }
    if (!current()) return;
    try {
      const chosen = await withTimeout(reads.delegateOf(wallet.address), WALLET_READ_MS);
      if (current()) this.set({ chosen: ready(chosen) });
    } catch (error) {
      if (current()) this.set({ chosen: failed(error, this.state.chosen.value) });
    }
  }
}
