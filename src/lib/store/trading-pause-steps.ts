/** What the pause shows while the follower waits on the next trading server, by how far the change has got. */

import type { WaitingStage } from "../engine/operator-follow-status";
import { CHAIN_UNREAD, CLOCK_FAILED, NEXT_REFUSED, STILL_PAUSED, WALLET_HOLD } from "../trading-pause-words";
import type { PauseShown, Steps } from "./trading-pause";

export const NOT_YET: Steps = { connect: "waiting", verify: "waiting", prices: "waiting", resume: "waiting" };

/** The steps, why one failed and what else holds the change, at `stage`. */
export function waitingSteps(stage: WaitingStage): PauseShown {
  switch (stage) {
    case "connecting":
      return { steps: { ...NOT_YET, connect: "current" }, failure: null };
    case "verifying":
      return { steps: { ...NOT_YET, connect: "done", verify: "current" }, failure: null };
    case "wallet":
      return { steps: { ...NOT_YET, connect: "done", verify: "done", prices: "current" }, failure: null, hold: WALLET_HOLD };
    case "unread":
      return { steps: { ...NOT_YET, connect: "current" }, failure: null, hold: CHAIN_UNREAD };
    case "refused":
      return { steps: { ...NOT_YET, connect: "done", verify: "failed" }, failure: `${NEXT_REFUSED} ${STILL_PAUSED}` };
    case "clock":
      return { steps: { ...NOT_YET, connect: "done", verify: "failed" }, failure: CLOCK_FAILED };
    default:
      return stage satisfies never;
  }
}
