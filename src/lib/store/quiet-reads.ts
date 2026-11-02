/**
 * Reads the node answered 404, held back so the refresh that prompts them (about once a second, and
 * on every event for the account) does not repeat them. The node signs every answer, so each repeat
 * costs it work per connected trader. Two kinds of 404 rest differently: a route the node does not
 * have rests long, and an account it has not credited yet rests a few seconds, with its eligibility
 * and withdrawal queue, and is read at once when an event for the account arrives. So is the history
 * of an account that has none, which rests until then.
 */

/** The House state route's key; a node that answers 404 there predates the route. */
export const HOUSE_STATE = "house-state";
/** How long a node without the House state route is left alone; the page closing and opening again, or a node restart, ends it sooner. */
export const ROUTE_ABSENT_MS = 300_000;
/** How long an account the node has not credited is left alone; an event for the account ends it at once. */
export const NOT_CREDITED_MS = 3_000;

/** How long a rest lasts when only an event for the account, or a reset, ends it. */
export const UNTIL_EVENT = Number.POSITIVE_INFINITY;

/** An account the node answered 404 for: neither it nor its entitlement exists there yet. */
export const uncreditedKey = (address: string): string => `uncredited:${address.toLowerCase()}`;

/** An account whose history the node answered empty: it has nothing to read until an event for the account. */
export const emptyHistoryKey = (address: string): string => `empty-history:${address.toLowerCase()}`;

export class QuietReads {
  private readonly until = new Map<string, number>();
  private generation = 0;

  constructor(private readonly nowMs: () => number = Date.now) {}

  /** Whether `key` rests now. */
  resting(key: string): boolean {
    const end = this.until.get(key);
    return end !== undefined && this.nowMs() < end;
  }

  /** Taken before a read starts and passed to `rest` with its 404: an event that arrived while it ran makes the 404 stale. */
  mark(): number {
    return this.generation;
  }

  /** Rests `key` for `ms` after a 404, unless an event or a reset has come since `mark` was taken. */
  rest(key: string, ms: number, mark: number): void {
    if (mark === this.generation) this.until.set(key, this.nowMs() + ms);
  }

  /** An event for the connected account arrived: its 404s may have just ended, so they are read at once. */
  accountEvent(): void {
    this.generation += 1;
    for (const key of [...this.until.keys()]) if (key !== HOUSE_STATE) this.until.delete(key);
  }

  /** Ends every rest: the page reopened, or the node restarted and may have gained the route. */
  reset(): void {
    this.generation += 1;
    this.until.clear();
  }
}
