/**
 * The session key signer, loaded apart from the page: it carries the curves a signature needs, which no
 * screen before a login runs. A live session loads it before its store exists (`loadSessionKeySigner`),
 * so every reader below stays synchronous; one that runs before then fails loudly, never as a bad key.
 */

import type { SessionKeySigner } from "./session-key";

let loaded: typeof SessionKeySigner | null = null;

/** Loads the signer once; later calls resolve at once. */
export async function loadSessionKeySigner(): Promise<void> {
  loaded ??= (await import("./session-key")).SessionKeySigner;
}

/** The signer class. Throws if `loadSessionKeySigner` has not finished. */
export function sessionKeySigner(): typeof SessionKeySigner {
  if (loaded === null) throw new Error("The session key signer is not loaded.");
  return loaded;
}
