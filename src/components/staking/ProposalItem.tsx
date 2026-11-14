"use client";

/**
 * One proposal on the Governance tab: its number and path, what it does, its tally against the
 * two-thirds threshold, the wait to its next step (voting closes, the change applies, the restriction
 * lapses) held at zero until the node's next answer moves it on, how the members the account delegates
 * to voted, the account's own vote where it is a member, and the command as proposed.
 */

import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";

import type { AdminCommandWire } from "@/lib/engine/governance-types";
import { formatLongCountdown, spokenLongCountdown } from "@/lib/monkey/countdown";
import { yesShareBps, type Tally } from "@/lib/staking/governance";
import { standingText, tallyText } from "@/lib/staking/governance-words";
import type { Standing } from "@/lib/staking/member-votes";

import { useConsoleSelect } from "../monkey/use-monkey";

/** Where a proposal stands: still taking votes, passed and waiting out its notice, or passed on the fast path and in force. */
export type Stage = "open" | "waiting" | "in-force";

/** A member the account delegates to, as the item names it, and how it stands on this proposal. */
export interface MemberLine {
  address: string;
  label: string;
  standing: Standing;
}

export interface ProposalItemProps {
  id: number;
  /** The id its heading carries, unique on the page. */
  headingId: string;
  fast: boolean;
  stage: Stage;
  title: string;
  details: readonly string[];
  /** The yes weight and the set's total; null for a passed proposal whose tally has not been read from the chain. */
  tally: Tally | null;
  /** The wait to the next step: what reaches it, when, what the place says once it has passed, and what to read again then. */
  wait: { label: string; atMs: number; reached: string; onReached: () => void };
  /** Null for a restriction, whose command the log does not keep, or for bytes that are no command. */
  command: AdminCommandWire | null;
  /** The members the account delegates to; null when they cannot be read. */
  members: readonly MemberLine[] | null;
  /** The account's own vote, on an open proposal. */
  vote?: ReactNode;
}

/** The time to the next step, from the console's sequenced clock; at its time it holds `reached` and asks once for the read that moves the proposal on. */
function Wait({ label, atMs, reached, onReached }: ProposalItemProps["wait"]) {
  const now = useConsoleSelect((state) => state.now);
  const passed = now > 0 && atMs <= now;
  const was = useRef(passed);
  const onPassed = useEffectEvent(onReached);
  useEffect(() => {
    if (passed && !was.current) onPassed();
    was.current = passed;
  }, [passed]);
  // A clock no frame has set yet would make every wait look a lifetime away.
  if (now <= 0) return <span className="text-caption text-fg-3">&nbsp;</span>;
  if (passed) return <span role="timer" className="text-caption text-fg-3">{reached}</span>;
  return (
    <span role="timer" aria-live="off" aria-label={`${label} in ${spokenLongCountdown(atMs, now)}`} className="text-caption text-glow tabular-nums">
      {label} in {formatLongCountdown(atMs, now)}
    </span>
  );
}

/** The tally in words and as a bar against the two-thirds mark; the bar is drawn for the eye, the sentence says it all. */
function TallyLine({ tally, open }: { tally: Tally; open: boolean }) {
  return (
    <div>
      <p className="text-caption leading-relaxed text-fg-2">{tallyText(tally, open)}</p>
      <div aria-hidden="true" className="relative mt-1 h-1.5 rounded-full bg-line-2">
        <div className="h-full rounded-full bg-glow" style={{ width: `${yesShareBps(tally) / 100}%` }} />
        <div className="absolute -top-0.5 -bottom-0.5 left-2/3 w-0.5 bg-fg" />
      </div>
    </div>
  );
}

export function ProposalItem({ id, headingId, fast, stage, title, details, tally, wait, command, members, vote }: ProposalItemProps) {
  const open = stage === "open";
  return (
    <li className="space-y-2 border-t border-line-2 pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 id={headingId} tabIndex={-1} className="text-label tracking-caps text-fg-3 uppercase outline-none">
          Proposal {id} · {fast ? "fast path" : "normal path"}
        </h4>
        <Wait {...wait} />
      </div>
      <p className="text-data leading-snug text-fg">{title}</p>
      {details.length > 0 && (
        <ul className="space-y-0.5 text-caption leading-relaxed text-fg-2">
          {details.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
      {tally !== null ? <TallyLine tally={tally} open={open} /> : <p className="text-caption text-fg-2">Passed with more than two thirds of its set&apos;s weight.</p>}
      {members !== null && members.length > 0 && (
        <div>
          <p className="text-label tracking-caps text-fg-3 uppercase">Members you delegate to</p>
          <ul className="mt-0.5 space-y-0.5 text-caption leading-relaxed text-fg-2">
            {members.map((member) => (
              <li key={member.address} className="[overflow-wrap:anywhere]">
                <span className="text-fg">{member.label}</span> {standingText(member.standing, open)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {vote}
      {command !== null && (
        <details className="text-caption text-fg-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-glow hover:text-glow-hover focus-visible:outline-2 focus-visible:outline-glow lg:min-h-6">The command as proposed</summary>
          <pre className="mt-1 rounded border border-line-2 bg-ink-2 p-2 text-label leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{JSON.stringify(command, null, 2)}</pre>
        </details>
      )}
    </li>
  );
}
