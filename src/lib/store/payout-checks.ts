/** The log checks the payouts wait on (monkey-trading/console#280): which checks each answer leaves standing, and when the payouts are read again, since figures update by themselves and a boundary that passes is followed by a read. */

import type { PayoutEntry, SignedWithdrawal } from "../engine/types";
import type { Payout } from "./payouts";
import type { PayoutCheck } from "./state";

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

/** Whether an unsigned payout waits for an operator's installation, which no time is known for. */
export function waitsForInstallation(payouts: readonly Payout[]): boolean {
  return payouts.some(({ status }) => status.kind === "waiting" && status.installation === true);
}

/** Whether an unsigned payout waits for a routine check within the turn in effect, which no time is known for. */
export function waitsForRoutineCheck(payouts: readonly Payout[]): boolean {
  return payouts.some(({ status }) => status.kind === "waiting" && status.routine === true);
}

/** How long until the payouts are read for a check at `checkAtMs`, at the node's clock `nowMs`: just after a boundary ahead, and at the slow pace once it has passed. */
export function checkReadDelay(checkAtMs: number, nowMs: number): number {
  // Never longer than a day: a timer past about 24.8 days fires at once, and a boundary that far off is the node's slip.
  return nowMs > 0 && checkAtMs > nowMs ? Math.min(checkAtMs - nowMs + AFTER_BOUNDARY_MS, MAX_DELAY_MS) : STILL_WAITING_MS;
}

/**
 * The check each approval the node names a log check for waits on, with the authorization `held` when it named it: a check that waits for an
 * installation, or for a routine check within the turn in effect (monkey-trading/console#535), carries no time; any other counts as a boundary, as an older node's answer does, and only a well-formed time counts, so a bad
 * answer leaves the row's plain wait. A later authorization overrides it where the status is worked out.
 */
export function checksOf(entries: readonly PayoutEntry[], held: readonly SignedWithdrawal[]): Record<number, PayoutCheck> {
  const checks: Record<number, PayoutCheck> = {};
  for (const { nonce, check } of entries) {
    if (check === undefined) continue;
    let atMs: number | null = null;
    const authorization = held.find((w) => w.nonce === nonce)?.authorization;
    const heldNow = authorization === undefined ? null : { epoch: authorization.signer_epoch, expiresAt: authorization.expires_at };
    if (check.waits === "check") {
      // The covering checkpoint's number is null while none is due; any other value that is not a whole number is a bad answer.
      if (check.checkpoint_seq !== null && !(Number.isSafeInteger(check.checkpoint_seq) && check.checkpoint_seq >= 0)) continue;
      checks[nonce] = { atMs: null, routine: true, held: heldNow };
      continue;
    }
    if (check.waits !== "installation") {
      if (check.waits !== undefined && check.waits !== "boundary") continue;
      if (!Number.isSafeInteger(check.boundary_ms) || check.boundary_ms <= 0) continue;
      atMs = check.boundary_ms;
    }
    checks[nonce] = { atMs, held: heldNow };
  }
  return checks;
}

/**
 * The checks after an answer that named `named` for `entries`: a complete answer is all there is to know, so it replaces what was held; an
 * incomplete one settles only the approvals it lists, and the checks held for the rest stay.
 */
export function checksKept(held: Record<number, PayoutCheck>, entries: readonly PayoutEntry[], named: Record<number, PayoutCheck>, complete: boolean): Record<number, PayoutCheck> {
  if (complete) return named;
  const listed = new Set(entries.map((entry) => entry.nonce));
  return { ...Object.fromEntries(Object.entries(held).filter(([nonce]) => !listed.has(Number(nonce)))), ...named };
}
