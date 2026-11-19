/**
 * A drop of the stream of the node in use while the follower has not explained it: what it concluded before the drop, and, for a drop around
 * a turn boundary at which the member changes, when the drop stops counting as a change of trading server.
 */

import { RETRY_MS } from "./operator-follow-pace";
import type { FollowStatus } from "./operator-follow-status";

export class DropHold {
  private before: FollowStatus | null = null;
  private windowEndMs: number | null = null;
  private lastReadAtMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly nowMs: () => number) {}

  /** A drop over `before`, at the node `origin`; `windowEndMs` ends a boundary's window, null away from any. Returns the state to show. */
  begin(before: FollowStatus, origin: string, windowEndMs: number | null): FollowStatus {
    this.before = before;
    this.windowEndMs = windowEndMs;
    return { kind: "confirming", origin, scheduled: windowEndMs !== null };
  }

  /** Whether a drop now is read at once: a feed that keeps dropping is read at the pace of other events, at most once in `RETRY_MS`. */
  readsAtOnce(): boolean {
    const nowMs = this.nowMs();
    if (nowMs - this.lastReadAtMs < RETRY_MS) return false;
    this.lastReadAtMs = nowMs;
    return true;
  }

  /** Whether `state` is a drop at a boundary still held as a change of server: its window has not passed and nothing has explained it. */
  holds(state: FollowStatus): boolean {
    return state.kind === "confirming" && state.scheduled && this.windowEndMs !== null && this.nowMs() < this.windowEndMs;
  }

  /** The end of the window of the drop `state` holds, or null. */
  windowEnd(state: FollowStatus): number | null {
    return this.holds(state) ? this.windowEndMs : null;
  }

  /** A conclusion a read reached while the drop is held, which ending it shows. */
  keep(state: FollowStatus): void {
    this.before = state;
  }

  /** Ends the drop, with what to show: the conclusion reached before it or while it was held. */
  end(origin: string): FollowStatus {
    const back = this.before ?? { kind: "following", origin };
    this.before = this.windowEndMs = null;
    return back;
  }
}
