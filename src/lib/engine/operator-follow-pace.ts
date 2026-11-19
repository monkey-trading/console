/** How long the operator follower waits before it reads again, from what its last read concluded. */

import type { Scheduler } from "./live-stream";
import { soonest, type FollowStatus } from "./operator-follow-status";

/** The slow read, in milliseconds. */
export const SLOW_READ_MS = 5 * 60_000;
/** The first wait before a target that did not verify or a read that failed is tried again, and the least time between event-driven reads, in milliseconds; waits double up to the slow read. */
export const RETRY_MS = 30_000;
/**
 * The first wait before a change of trading server under way is read again, in milliseconds: a successor that has not answered or is
 * being checked, or a drop at a turn boundary the chain has not yet explained. The engine's successor serves within seconds of the
 * boundary, so the waits double from here only up to `RETRY_MS`.
 */
export const SWITCH_RETRY_MS = 2_000;
/** How long after a pending election's effective time it is read again, so the chain has passed it, in milliseconds. */
const AFTER_EFFECT_MS = 5_000;

/** The follower's timed read: when it comes, from what the last read concluded and what the follower has heard since. */
export class FollowPace {
  /** The pending election's effective time, a chain event that has a known time. */
  effectiveAtMs: number | null = null;
  /** When the node says its next daily turn begins, another; null when it said none. */
  turnAtMs: number | null = null;
  /** Whether the stream of the node in use is down: its outage is read again soon, as a successor the chain did not yet name may be on its way. */
  streamDown = false;
  private wait = RETRY_MS;
  private switchWait = SWITCH_RETRY_MS;
  private timer: unknown = null;
  private dueAtMs: number | null = null;

  constructor(private readonly scheduler: Scheduler, private readonly nowMs: () => number) {}

  /** Runs `fire` once after `delay`, in place of a read already timed. */
  schedule(delay: number, fire: () => void): void {
    this.cancel();
    this.dueAtMs = this.nowMs() + delay;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = this.dueAtMs = null;
      fire();
    }, delay);
  }

  cancel(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = this.dueAtMs = null;
  }

  /** How long until the read timed now comes, or null with none timed. */
  pendingMs(): number | null {
    return this.dueAtMs === null ? null : Math.max(0, this.dueAtMs - this.nowMs());
  }

  /** Whether `state` is a change of server under way, which is read again within seconds and whatever the node in use says of its turns. */
  static switching(state: FollowStatus): boolean {
    return (state.kind === "waiting" && state.stage !== "refused" && state.stage !== "clock") || (state.kind === "confirming" && state.scheduled);
  }

  /** A drop or a hidden tab coming back is new evidence: the next waits start from the first again. */
  restart(): void {
    this.wait = RETRY_MS;
    this.switchWait = SWITCH_RETRY_MS;
  }

  /**
   * The wait after a read that concluded `input.state`: a change of server under way, within seconds and waiting longer each time up to
   * `RETRY_MS`, and no later than the end of the window of a drop at a boundary (`dropWindowEndMs`); a target refused, a read that failed,
   * a node in use that stays down or an effective time just past, soon and then slower; the effective time ahead; or the slow read.
   */
  next(state: FollowStatus, dropWindowEndMs: number | null): number {
    const nowMs = this.nowMs();
    if (FollowPace.switching(state)) {
      const delay = this.switchWait;
      this.switchWait = Math.min(this.switchWait * 2, RETRY_MS);
      return dropWindowEndMs === null ? delay : Math.max(0, Math.min(delay, dropWindowEndMs - nowMs));
    }
    this.switchWait = SWITCH_RETRY_MS;
    const changeAtMs = soonest(this.effectiveAtMs, this.turnAtMs);
    const untilEffect = changeAtMs === null ? null : changeAtMs - nowMs;
    if (state.kind === "waiting" || state.kind === "failed" || this.streamDown || (untilEffect !== null && untilEffect <= 0)) {
      const delay = this.wait;
      this.wait = Math.min(this.wait * 2, SLOW_READ_MS);
      return delay;
    }
    this.wait = RETRY_MS;
    return untilEffect === null ? SLOW_READ_MS : Math.min(SLOW_READ_MS, untilEffect + AFTER_EFFECT_MS);
  }
}
