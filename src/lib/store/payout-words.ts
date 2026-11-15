/** What a payout row says while its authorization is not signed yet. */

import { formatStamp } from "../time";

/**
 * With the boundary of the log check the node names (monkey-trading/console#280), the check's time; a boundary already past says the
 * check has not completed; without one, the checkpoint alone. `nowMs` is the node's clock.
 */
export function waitingWords(checkAtMs: number | undefined, nowMs: number): string {
  if (checkAtMs === undefined) return "Waiting for the next checkpoint. The node signs the authorization once a checkpoint covering the approval is confirmed on chain, and it arrives here by itself.";
  const when = nowMs > 0 && checkAtMs <= nowMs ? `Waiting for the check of the log due at ${formatStamp(checkAtMs)} UTC, which has not completed yet` : `Waiting for the next check of the log, at ${formatStamp(checkAtMs)} UTC`;
  return `${when}. The node signs the authorization once a checkpoint covering the approval is confirmed on chain and another operator has verified the log through it, and it arrives here by itself.`;
}
