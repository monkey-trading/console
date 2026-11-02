/** What the live client waits on with a deadline: loading the verifier, and the wallet's read of the vault. */

import type { Scheduler } from "./live-stream";
import type { DeploymentReads, VaultFacts } from "./registry";
import type { Verifier } from "./verifier";

/** How long loading the verifier may take, in milliseconds. */
const VERIFIER_LOAD_TIMEOUT_MS = 20_000;
/** How long the wallet may take over the vault's reads before the check goes on without them; every read of the node waits on that check, so a wallet asleep must not hold them. */
const VAULT_READ_TIMEOUT_MS = 10_000;
/** How long a good answer from the vault serves a check again, in milliseconds. */
const VAULT_HELD_MS = 30_000;

/**
 * The vault's facts through the connected wallet, for the trust check. Every read of the node waits
 * on that check, so a wallet that does not answer in time is left behind, and told about if it answers
 * later. A good answer is kept for a while: a node that keeps failing its check is checked again on
 * every retry, and each retry must not cost the wallet's provider a read.
 */
export class VaultReads {
  private chain: DeploymentReads | null = null;
  private held: { atMs: number; facts: VaultFacts } | null = null;

  constructor(private readonly scheduler: Scheduler, private readonly nowMs: () => number, private readonly onLate: () => void) {}

  /** The wallet whose reads to use; another wallet's answer is not kept. */
  use(chain: DeploymentReads | null): void {
    if (chain !== this.chain) this.held = null;
    this.chain = chain;
  }

  /** Whether `chain` is the wallet in use. */
  uses(chain: DeploymentReads | null): boolean {
    return chain === this.chain;
  }

  /** Keeps facts just read elsewhere through the same wallet. */
  note(facts: VaultFacts): void {
    this.held = { atMs: this.nowMs(), facts };
  }

  /** The facts, bounded in time; null with no wallet that reads a chain. */
  facts(): Promise<VaultFacts> | null {
    const chain = this.chain;
    if (chain === null) return null;
    if (this.held !== null && this.nowMs() - this.held.atMs < VAULT_HELD_MS) return Promise.resolve(this.held.facts);
    let gaveUp = false;
    return new Promise((resolve, reject) => {
      const timer = this.scheduler.setTimeout(() => {
        gaveUp = true;
        reject(new Error("your wallet did not answer in time"));
      }, VAULT_READ_TIMEOUT_MS);
      chain.vault().then(
        (facts) => {
          this.scheduler.clearTimeout(timer);
          if (chain === this.chain) this.note(facts);
          resolve(facts);
          if (gaveUp && chain === this.chain) this.onLate();
        },
        (error: unknown) => {
          this.scheduler.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
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
