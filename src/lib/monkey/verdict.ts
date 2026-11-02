/**
 * What a claim panel may say of the vault's checkpoint against the node's proof (monkey-trading/console#202).
 * The two are read separately, and a first request for a proof answers at the node's newest
 * checkpoint, which can be ahead of the vault's, so a pair that disagrees is usually a pair read
 * a moment apart. Such a pair shows as checking, and is read again by itself, until it has lasted
 * past the grace period: only then does the panel say it waits on the vault.
 */

/** How long a disagreement may last before the panel says it is waiting on the vault, in milliseconds. */
export const CHECK_GRACE_MS = 20_000;
/** How soon a pair that disagrees is read again, in milliseconds. */
export const RECHECK_MS = 2_000;

export type Checkpoint = "unknown" | "waiting" | "posted";

/** Whether the vault's checkpoint and the node's proof disagree: the vault is behind the proof. One past it still takes the claim. */
export const disagrees = (checkpoint: Checkpoint): boolean => checkpoint === "waiting";

/** What to say of `checkpoint` when its disagreement, if any, has lasted `elapsed` or not: `checking` for a young one. */
export const verdict = (checkpoint: Checkpoint, elapsed: boolean): Checkpoint | "checking" => (disagrees(checkpoint) && !elapsed ? "checking" : checkpoint);
