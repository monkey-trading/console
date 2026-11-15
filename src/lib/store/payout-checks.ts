/** When the payouts are read again for the log checks they wait on (monkey-trading/console#280): figures update by themselves, so a boundary that passes is followed by a read. */

import type { Payout } from "./payouts";

/** How long after a boundary the payouts are read, so the node has had its check, in milliseconds. */
export const AFTER_BOUNDARY_MS = 5_000;
/** The longest wait before a read, in milliseconds. */
export const MAX_DELAY_MS = 86_400_000;
/** How often they are read while a boundary has passed and the node still names it, in milliseconds. */
export const STILL_WAITING_MS = 60_000;

/** The earliest boundary an unsigned payout waits for its log check at, or null when none waits for one. */
export function earliestCheck(payouts: readonly Payout[]): number | null {
  let earliest: number | null = null;
  for (const { status } of payouts) {
    if (status.kind === "waiting" && status.checkAtMs !== undefined && (earliest === null || status.checkAtMs < earliest)) earliest = status.checkAtMs;
  }
  return earliest;
}

/** How long until the payouts are read for a check at `checkAtMs`, at the node's clock `nowMs`: just after a boundary ahead, and at the slow pace once it has passed. */
export function checkReadDelay(checkAtMs: number, nowMs: number): number {
  // Never longer than a day: a timer past about 24.8 days fires at once, and a boundary that far off is the node's slip.
  return nowMs > 0 && checkAtMs > nowMs ? Math.min(checkAtMs - nowMs + AFTER_BOUNDARY_MS, MAX_DELAY_MS) : STILL_WAITING_MS;
}
