"use client";

/**
 * A member's yes vote on an open proposal (`ParameterVote.vote`): the button while the account may
 * vote, what it did once it has, and, under the proposal it was pressed on, the wallet's request and
 * any refusal or failure. A vote that lands needs no message: the line saying the account voted
 * replaces the button, in a status region kept mounted while the account is a member, so it is read out.
 */

import type { ReactNode } from "react";

import { formatMonkey } from "@/lib/format";
import { castVote } from "@/lib/monkey/actions";
import type { Standing } from "@/lib/staking/member-votes";

import { Notice } from "../Notice";
import { focusHeading } from "../monkey/Card";
import { BUTTON } from "../monkey/styles";
import { useConsoleSelect } from "../monkey/use-monkey";
import { useStaking } from "../StakingSection";

export interface VoteControlProps {
  /** The vote contract, from the node's signed list. */
  vote: string;
  id: number;
  /** The account's standing and weight in the proposal's set; null weight until the set is read. */
  standing: Standing;
  weight: bigint | null;
  /** Whether the registry has rotation on, without which the contract takes no votes. */
  rotationOn: boolean;
  /** When the proposal stops taking votes, which the console's clock decides here. */
  closesAtMs: number;
  /** Whether the `governance` notice speaks for this proposal: the account last voted from here. */
  noticeHere: boolean;
  /** The proposal's heading, which takes focus when a vote that landed removes the button. */
  headingId: string;
}

export function VoteControl({ vote, id, standing, weight, rotationOn, closesAtMs, noticeHere: here, headingId }: VoteControlProps) {
  const { panel, operators, memberVotes } = useStaking();
  const busy = useConsoleSelect((state) => state.busy);
  const open = useConsoleSelect((state) => state.now > 0 && closesAtMs > state.now);
  // The notice stays with the proposal it was pressed on whatever the control shows now, so a prompt or a refusal is never left without a place.
  const notice = here ? <Notice surface="governance" /> : null;
  const member = weight !== null && weight > 0n && (standing === "yes" || standing === "no");
  let control: ReactNode = null;
  if (member && standing === "no" && open && !rotationOn) control = <p className="text-caption text-fg-2">The vote contract takes no votes while operator rotation is off.</p>;
  else if (member && standing === "no" && open) {
    control = (
      <button
        type="button"
        aria-disabled={busy}
        aria-label={`Vote yes with ${formatMonkey(weight)} on proposal ${id}`}
        className={BUTTON}
        onClick={() => {
          if (!busy) void castVote(panel, operators, memberVotes, vote, id).then((landed) => landed && focusHeading(headingId));
        }}
      >
        Vote yes with {formatMonkey(weight)}
      </button>
    );
  }
  if (!member && notice === null) return null;
  return (
    <div>
      {control}
      {member && <div role="status">{standing === "yes" && <p className="text-caption text-glow">You voted yes with {formatMonkey(weight)}.</p>}</div>}
      {notice}
    </div>
  );
}
