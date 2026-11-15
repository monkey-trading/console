/** What a payout row says while its authorization is not signed yet. */

import { formatStamp } from "../time";

/** With the boundary of the log check the node names (monkey-trading/console#280), the check's time; without one, the checkpoint alone. */
export function waitingWords(checkAtMs: number | undefined): string {
  if (checkAtMs === undefined) return "Waiting for the next checkpoint. The node signs the authorization once a checkpoint covering the approval is confirmed on chain, and it arrives here by itself.";
  return `Waiting for the next check of the log, at ${formatStamp(checkAtMs)} UTC. The node signs the authorization once a checkpoint covering the approval is confirmed on chain and another operator has verified the log through it, and it arrives here by itself.`;
}
