/** One WalletConnect connect in progress, which a cancel stops. */

export class Attempt {
  /** Rejects once the attempt is cancelled; the connect races it. */
  readonly stopped: Promise<never>;
  private error: Error | null = null;
  private reject: (error: Error) => void = () => undefined;

  constructor() {
    this.stopped = new Promise<never>((_, reject) => {
      this.reject = reject;
    });
  }

  cancel(error: Error): void {
    this.error = error;
    this.reject(error);
  }

  /** Throws once the attempt is cancelled, so a step after an `await` goes no further. */
  check(): void {
    if (this.error !== null) throw this.error;
  }
}
