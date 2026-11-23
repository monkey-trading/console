/** What a payout row says while its authorization is not signed yet. */

import { formatStamp } from "../time";

/**
 * With the boundary of the log check the node names (monkey-trading/console#280), the check's time; a boundary already past says the
 * check has not completed; waiting for an installation (monkey-trading/console#521), no time; without either, the checkpoint alone. `nowMs` is the node's clock.
 */
export function waitingWords(checkAtMs: number | undefined, nowMs: number, installation = false): string {
  if (installation) return "The withdrawal is waiting for the platform's operator to be confirmed. You can claim the withdrawal here once that has happened and the vault has recorded the next snapshot.";
  if (checkAtMs === undefined) return "You can claim the withdrawal here once the vault has recorded the next snapshot.";
  const when = nowMs > 0 && checkAtMs <= nowMs ? `The withdrawal is waiting for a check of the server's records that was due at ${formatStamp(checkAtMs)} UTC and has not yet been completed` : `The withdrawal is waiting for the next check of the server's records, which is due at ${formatStamp(checkAtMs)} UTC`;
  return `${when}. You can claim the withdrawal here once the vault has recorded the next snapshot and another operator's server has independently checked the records.`;
}
