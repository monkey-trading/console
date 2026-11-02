/** A press that must be repeated within a short window: the first arms it, the window lapses on its own, a press after it starts over. */

import type { Scheduler } from "./engine/live-stream";

/** Where the window stands at a press: nothing armed, armed but too soon to confirm (a double-click's second click), or ready to confirm. */
export type ConfirmState = "idle" | "early" | "ready";

export class ConfirmWindow {
  private armed = false;
  private armedAt = 0;
  private timer: unknown = null;
  private readonly listeners = new Set<() => void>();

  /** `now` is the clock the deadline is checked against, so a timer callback delayed past it cannot leave a press confirming. */
  constructor(private readonly scheduler: Scheduler, private readonly lapseMs: number, private readonly minGapMs: number, private readonly now: () => number) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Whether the window is open, for what the button shows. */
  isArmed = (): boolean => this.armed;

  /** What a press does now. A window past its deadline whose timer has not run yet is closed here. */
  state = (): ConfirmState => {
    if (!this.armed) return "idle";
    const age = this.now() - this.armedAt;
    if (age >= this.lapseMs) {
      this.cancel();
      return "idle";
    }
    return age < this.minGapMs ? "early" : "ready";
  };

  /** Opens the window; a window already open keeps its original end. */
  arm = (): void => {
    if (this.armed) return;
    this.armed = true;
    this.armedAt = this.now();
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      this.armed = false;
      this.notify();
    }, this.lapseMs);
    this.notify();
  };

  /** Closes the window and drops its timer. Safe to call when nothing is armed, and again after. */
  cancel = (): void => {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    if (!this.armed) return;
    this.armed = false;
    this.notify();
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
