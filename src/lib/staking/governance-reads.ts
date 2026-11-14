/**
 * The Governance tab's read of the node's signed `GET /v1/house/state` (monkey-trading/console#281):
 * the passed changes waiting out their notice, the restrictions in force, and the parameters in force
 * they are told against. Read on open, at the node read's 30-second pace while the tab is visible,
 * as soon as the stream carries a vote's outcome (a change scheduled or applied, a restriction applied
 * or lapsed), when a countdown reaches its time, and only while the node's answers may be read. What
 * was read stays across a tab switch, unless trust is lost or another verified enclave holds the node.
 */

import { readBlock } from "../engine/attestation";
import type { HouseParams } from "../house";
import { failed, LOADING, ready, type Read } from "../monkey/figures";
import { NODE_READ_MS } from "../monkey/panel";
import { EnclaveBinding } from "../store/enclave-binding";
import type { ConsoleStore } from "../store/store";
import { governanceView, type GovernanceView } from "./governance";

/** What the tab shows from the house state: the votes the log holds, and the parameters in force at the same seq. */
export interface GovernanceRead {
  view: GovernanceView;
  params: HouseParams | null;
}

/** The stream's events that change what the house state says of the votes. */
const OUTCOMES: ReadonlySet<string> = new Set(["proposal_scheduled", "restriction_applied", "proposal_refused", "restriction_lapsed", "admin_applied", "admin_rejected"]);

const UNAVAILABLE = { status: "unavailable", value: null, message: null } as const;

export class GovernanceReads {
  private state: Read<GovernanceRead> = LOADING;
  private readonly listeners = new Set<() => void>();
  /** Counts openings; a read begun in an earlier one never writes into a later one. */
  private cycle = 0;
  private open = false;
  /** Numbers each read: only the latest may land. */
  private ticket = 0;
  private readonly enclave: EnclaveBinding;

  constructor(private readonly store: ConsoleStore) {
    this.enclave = new EnclaveBinding(store);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): Read<GovernanceRead> => this.state;

  private set(next: Read<GovernanceRead>): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private nodeReadable(): boolean {
    return readBlock(this.store.getSnapshot().attestation, "live") === null;
  }

  /** Empties the read: an answer on its way came from a node trust has left. */
  private drop(): void {
    this.ticket += 1;
    this.set(LOADING);
  }

  /** Starts the reads, and returns what stops them. While `isHidden` says the tab is hidden the timer reads nothing. */
  start(isHidden: () => boolean): () => void {
    this.open = true;
    this.cycle += 1;
    let readable = this.nodeReadable();
    if (!readable || this.enclave.replaced()) this.drop();
    void this.refresh();
    const stopFollowing = this.store.subscribe(() => {
      const now = this.nodeReadable();
      const replaced = now && this.enclave.replaced();
      if (now === readable && !replaced) return;
      readable = now;
      if (!now || replaced) this.drop();
      if (now) void this.refresh();
    });
    const timer = setInterval(() => {
      if (!isHidden()) void this.refresh();
    }, NODE_READ_MS);
    const unsubscribe = this.store.deps.client.subscribe((message) => {
      if (message.events.some((event) => OUTCOMES.has(event.type))) void this.refresh();
    });
    return () => {
      this.open = false;
      this.cycle += 1;
      clearInterval(timer);
      unsubscribe();
      stopFollowing();
    };
  }

  /** Reads the house state, while the node's answers may be read; a node without the route is not asked again. A malformed answer is a failed read, and the last good one stays. */
  async refresh(): Promise<void> {
    if (!this.open || !this.nodeReadable() || this.state.status === "unavailable") return;
    const ticket = ++this.ticket;
    const cycle = this.cycle;
    const current = () => ticket === this.ticket && cycle === this.cycle;
    try {
      const state = await this.store.deps.client.houseState();
      if (!current()) return;
      this.set(state === null ? UNAVAILABLE : ready({ view: governanceView(state.governance), params: state.params }));
    } catch (error) {
      if (current()) this.set(failed(error, this.state.value));
    }
  }
}
