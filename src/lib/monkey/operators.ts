/**
 * The Staking page's operator reads, all from the node and all signed: `GET /v1/operator`, the key in
 * effect as the log mirrors it, and `GET /v1/operators`, the registry's candidates as the custody
 * quorum read them at a final block (monkey-trading/engine#590), never one chain call per candidate
 * (monkey-trading/console#279). Both are read on open, at the page's 30-second pace while the tab is
 * visible, on an election or rotation event in the stream, and after a delegation, and only while the
 * node's answers may be read. The account's own delegations come from the wallet's staking reads.
 */

import { readBlock, type AttestationStatus, type FeedStatus } from "../engine/attestation";
import type { OperatorRoute } from "../engine/stats-types";
import { operatorsView, type OperatorsView } from "../staking/operator-table";
import type { ConsoleStore } from "../store/store";
import { failed, LOADING, ready, type Read } from "./figures";
import { NODE_READ_MS } from "./panel";

export interface OperatorsState {
  /** What the node's log mirrors. */
  route: Read<OperatorRoute>;
  /** The registry's candidates at the final block the node last read; unavailable from a node with no registry lens. */
  list: Read<OperatorsView>;
  /**
   * The last list read while the node was trusted, and when, by this device's clock: kept while trust
   * is lost, so a staker can still choose a candidate to delegate to away from a node that failed.
   * Nothing on the page shows it as current; it is gone when the page closes.
   */
  held: { view: OperatorsView; verifiedAtMs: number } | null;
}

const NOTHING_READ: OperatorsState = { route: LOADING, list: LOADING, held: null };

/**
 * Whether the Staking page shows its operators card: with the rest of the figures once the node is
 * trusted, and on its own once the node has failed a check or its feed has gone stale, so a staker
 * can still vote away from it. Until the first verdict it waits with the rest, so nothing it holds is
 * pushed down when the figures land.
 */
export function operatorsShown(attestation: AttestationStatus, stream: FeedStatus): boolean {
  return readBlock(attestation, stream) === null || attestation.kind === "unverified" || attestation.kind === "clock" || stream === "stale";
}

/** An election the log mirrors and has not applied: what the page shows of a pending election the list does not show yet. */
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
  /** Numbers each read: only the latest of a kind may land. */
  private routeRead = 0;
  private listRead = 0;

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
    void this.refresh();
    // No figure from a node the console has stopped trusting stays on the card, and a node trusted again is read at once.
    let readable = this.nodeReadable();
    const stopFollowing = this.store.subscribe(() => {
      const now = this.nodeReadable();
      if (now === readable) return;
      readable = now;
      if (now) void this.refresh();
      else {
        // An answer on its way came from the node trust just left.
        this.routeRead += 1;
        this.listRead += 1;
        this.set({ route: LOADING, list: LOADING });
      }
    });
    const timer = setInterval(() => {
      if (!isHidden()) void this.refresh();
    }, NODE_READ_MS);
    const unsubscribe = this.store.deps.client.subscribe((message) => {
      if (message.events.some((event) => event.type === "operator_elected" || event.type === "rotation_switched")) void this.refresh();
    });
    return () => {
      this.open = false;
      this.cycle += 1;
      clearInterval(timer);
      unsubscribe();
      stopFollowing();
      this.set(NOTHING_READ);
    };
  }

  /** Reads both routes, while the node's answers may be read; a route the node does not serve is not asked again. */
  async refresh(): Promise<void> {
    if (!this.nodeReadable() || !this.open) return;
    await Promise.all([
      this.state.route.status === "unavailable" ? undefined : this.readRoute(),
      this.state.list.status === "unavailable" ? undefined : this.readList(),
    ]);
  }

  private async readRoute(): Promise<void> {
    const ticket = ++this.routeRead;
    const cycle = this.cycle;
    try {
      const route = await this.store.deps.client.stats.operator();
      if (ticket === this.routeRead && cycle === this.cycle) this.set({ route: ready(route) });
    } catch (error) {
      if (ticket === this.routeRead && cycle === this.cycle) this.set({ route: failed(error, this.state.route.value) });
    }
  }

  /** The list, checked as it is turned into the page's view: a malformed answer is a failed read, and the last good one stays. */
  private async readList(): Promise<void> {
    const ticket = ++this.listRead;
    const cycle = this.cycle;
    try {
      const list = operatorsView(await this.store.deps.client.stats.operators());
      if (ticket === this.listRead && cycle === this.cycle) this.set({ list: ready(list), held: { view: list, verifiedAtMs: Date.now() } });
    } catch (error) {
      if (ticket === this.listRead && cycle === this.cycle) this.set({ list: failed(error, this.state.list.value) });
    }
  }
}
