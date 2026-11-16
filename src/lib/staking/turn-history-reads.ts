/**
 * The Rotation tab's older turns (monkey-trading/console#280): the newest page rides on the node's
 * `GET /v1/operator`, which the operator reads repeat on their own, and "Load older" reads the pages
 * before it from the same route with its `before` mark. Older pages are kept apart from the newest
 * page and join it only while it still reaches back to where the first older page began; once a new
 * assignment has moved it past, they are left out, since turns between might be missing, and read
 * again by the next "Load older". They are also dropped when the node stops being trusted, or another
 * verified enclave holds it.
 */

import { readBlock } from "../engine/attestation";
import { EnclaveBinding } from "../store/enclave-binding";
import type { ConsoleStore } from "../store/store";
import { turnHistory, type TurnHistory, type TurnRecord } from "./rotation";

/** Records per older page. */
export const TURNS_PAGE = 20;
/** Most records held; none is read past it. */
export const MAX_HELD_TURNS = 2_000;

/** What was read before the newest page: the records, where the next page begins, and where the first began. */
export interface OlderTurns {
  records: readonly TurnRecord[];
  /** The newest page's `next` when the first older page was read: the newest page still reaches it only while its own `next` is no later. */
  anchor: number | null;
  /** The `before` for the page after these; null once none is held. */
  next: number | null;
  truncated: boolean;
}

export const NO_OLDER: OlderTurns = { records: [], anchor: null, next: null, truncated: false };

export interface TurnPagesState {
  older: OlderTurns;
  /** Whether an older page is being read. */
  reading: boolean;
  /** Why the last older read failed; null after one that landed. */
  error: string | null;
}

const IDLE: TurnPagesState = { older: NO_OLDER, reading: false, error: null };

/** A record's identity: one command mirrors one assignment of a turn's position. */
const keyOf = (record: TurnRecord) => `${record.assignedSeq}:${record.turn}:${record.position}`;

/**
 * The history `head` (the newest page) and `older` make together: the newest page, then older records
 * not already in it. With a gap — the newest page now starts past where the older ones began — the
 * older ones are left out.
 */
export function joinHistory(head: TurnHistory, older: OlderTurns): TurnHistory {
  const reaches = older.records.length > 0 && head.next !== null && older.anchor !== null && head.next <= older.anchor;
  if (!reaches) return head;
  const seen = new Set(head.records.map(keyOf));
  const records = [...head.records, ...older.records.filter((record) => !seen.has(keyOf(record)))].slice(0, MAX_HELD_TURNS);
  return { records, next: records.length >= MAX_HELD_TURNS ? null : older.next, truncated: older.truncated };
}

export class TurnHistoryReads {
  private state: TurnPagesState = IDLE;
  private readonly listeners = new Set<() => void>();
  /** Counts reads: only the latest may land. */
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

  getSnapshot = (): TurnPagesState => this.state;

  private set(state: TurnPagesState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  /** Starts watching the node's trust, and returns what stops it: older pages signed by a node trust has left are dropped. */
  start(): () => void {
    let readable = readBlock(this.store.getSnapshot().attestation, "live") === null;
    // A node trust left, or another verified enclave now holding it, while the tab was closed: what was kept was signed by one the console stopped trusting.
    if (!readable || this.enclave.replaced()) this.drop();
    const stop = this.store.subscribe(() => {
      const now = readBlock(this.store.getSnapshot().attestation, "live") === null;
      const replaced = now && this.enclave.replaced();
      if (now === readable && !replaced) return;
      readable = now;
      if (!now || replaced) this.drop();
    });
    return stop;
  }

  private drop(): void {
    this.ticket += 1;
    this.set(IDLE);
  }

  /**
   * Reads the page before the oldest record shown: `head` is the newest page, which says where to
   * begin while no older page is held. A read in flight, or an end already reached, reads nothing.
   */
  async loadOlder(head: TurnHistory): Promise<void> {
    const shown = joinHistory(head, this.state.older);
    const before = shown.next;
    if (this.state.reading || before === null) return;
    const ticket = ++this.ticket;
    const held = this.state.older;
    const continuing = held.records.length > 0 && shown !== head;
    this.set({ older: continuing ? held : NO_OLDER, reading: true, error: null });
    try {
      const route = await this.store.deps.client.stats.operator({ before, limit: TURNS_PAGE });
      const page = turnHistory(route.turns);
      if (ticket !== this.ticket) return;
      const base = continuing ? held : { ...NO_OLDER, anchor: head.next };
      this.set({ older: { records: [...base.records, ...page.records], anchor: base.anchor, next: page.next, truncated: page.truncated }, reading: false, error: null });
    } catch (error) {
      if (ticket !== this.ticket) return;
      this.set({ older: continuing ? held : NO_OLDER, reading: false, error: error instanceof Error ? error.message : "" });
    }
  }
}
