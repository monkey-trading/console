/** What a payout row says while its authorization is not signed yet. */

import { formatStamp } from "../time";

/**
 * With the boundary of the log check the node names (monkey-trading/console#280), the check's time; a boundary already past says the
 * check has not completed; without one, the checkpoint alone. `nowMs` is the node's clock.
 */
export function waitingWords(checkAtMs: number | undefined, nowMs: number): string {
  if (checkAtMs === undefined) return "Waiting for the server's next snapshot to the vault. Once it's confirmed on chain, you can claim this withdrawal here.";
  const when = nowMs > 0 && checkAtMs <= nowMs ? `Waiting for the check of the server's records due at ${formatStamp(checkAtMs)} UTC, which hasn't finished yet` : `Waiting for the next check of the server's records, at ${formatStamp(checkAtMs)} UTC`;
  return `${when}. Once the server's next snapshot is confirmed on chain and another server has checked its records, you can claim this withdrawal here.`;
}
