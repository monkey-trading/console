/**
 * Which enclave a read's retained answers came from. A read that keeps its signed pages across a
 * stop asks `replaced` at each start: a different verified enclave now holds the node (an approved
 * upgrade), so what it kept was signed by one the console stopped trusting and must be read afresh.
 */

import { enclaveOf } from "../engine/attestation";
import type { ConsoleStore } from "./store";

export class EnclaveBinding {
  /** The last verified enclave seen; null before any. */
  private held: string | null = null;

  constructor(private readonly store: ConsoleStore) {}

  /**
   * Whether the verified enclave differs from the one last seen, and records the one now. False while
   * none is verified, which leaves the last one in place: the reads stay stopped until one is.
   */
  replaced(): boolean {
    const now = enclaveOf(this.store.getSnapshot().attestation);
    if (now === null) return false;
    const was = this.held;
    this.held = now;
    return was !== null && was !== now;
  }
}
