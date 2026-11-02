/** Runs an action at most once per interval: the first request runs at once, and a request made during the wait runs when it ends. */

export class Throttle {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;

  constructor(private readonly intervalMs: number, private readonly run: () => void) {}

  /** Asks for a run: now if none ran within the interval, else once when the interval ends. */
  request(): void {
    if (this.timer !== null) {
      this.pending = true;
      return;
    }
    this.fire();
  }

  /** Drops the wait and any run it was holding, so nothing fires after the store stops. */
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
  }

  private fire(): void {
    this.pending = false;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending) this.fire();
    }, this.intervalMs);
    this.run();
  }
}
