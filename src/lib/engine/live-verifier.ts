/** What the live client waits on with a deadline: loading the verifier, and the wallet's read of the vault. */

import type { Scheduler } from "./live-stream";
import type { VaultFacts } from "./registry";
import type { Verifier } from "./verifier";

/** How long loading the verifier may take, in milliseconds. */
const VERIFIER_LOAD_TIMEOUT_MS = 20_000;
/** How long the wallet may take over the vault's reads before the check goes on without them; every read of the node waits on that check, so a wallet asleep must not hold them. */
const VAULT_READ_TIMEOUT_MS = 10_000;

/** `read`, or a rejection once the wallet has had its time. */
export function boundedVaultRead(read: Promise<VaultFacts>, scheduler: Scheduler): Promise<VaultFacts> {
  return new Promise((resolve, reject) => {
    const timer = scheduler.setTimeout(() => reject(new Error("your wallet did not answer in time")), VAULT_READ_TIMEOUT_MS);
    read.then(
      (facts) => { scheduler.clearTimeout(timer); resolve(facts); },
      (error: unknown) => { scheduler.clearTimeout(timer); reject(error); },
    );
  });
}

/** Loads the verifier once, within a deadline. */
export class VerifierLoader {
  private ready: Promise<Verifier> | null = null;
  private held: Verifier | null = null;

  constructor(private readonly loadVerifier: () => Promise<Verifier>, private readonly scheduler: Scheduler) {}

  /** The verifier, loading it the first time. */
  load(): Promise<Verifier> {
    if (this.ready === null) {
      const timer = { handle: null as unknown };
      const deadline = new Promise<never>((_, reject) => {
        timer.handle = this.scheduler.setTimeout(() => reject(new Error("The verifier took too long to load.")), VERIFIER_LOAD_TIMEOUT_MS);
      });
      this.ready = Promise.race([this.loadVerifier(), deadline]).then(
        (verifier) => {
          this.scheduler.clearTimeout(timer.handle);
          return (this.held = verifier);
        },
        (error: unknown) => {
          this.scheduler.clearTimeout(timer.handle);
          this.ready = null; // a failed or stalled load is tried again on the next check
          throw error;
        },
      );
    }
    return this.ready;
  }

  /** The loaded verifier; the trust check that precedes every use has loaded it. */
  loaded(): Verifier {
    if (this.held === null) throw new Error("The verifier was used before it loaded.");
    return this.held;
  }
}
