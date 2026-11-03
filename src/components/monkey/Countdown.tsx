"use client";

/** A quiet countdown to a time on the node's clock, such as the next MONKEY budget; nothing when the time is unknown. At the boundary it holds "Waiting for the checkpoint" until the node's answer for the closed period or epoch lands. */

import { useEffect, useRef } from "react";

import { budgetAwaitingCheckpoint, closeAwaitingCheckpoint, formatCountdown, nextBudgetMs, nextCloseMs, spokenCountdown } from "@/lib/monkey/countdown";

import { useConsoleSelect, useMonkeyPanel, usePanelState } from "./use-monkey";

/**
 * `at` computes the target from the clock, so a time already passed rolls on to the next. The clock
 * is the console's sequenced one, never the device's, and the redraw is that clock's own tick: no read.
 * `awaiting` says the boundary the answer still holds has passed; then the waiting text stands in the
 * countdown's place until a fresh answer lands, and crossing into it asks the panel for one read now,
 * not at the next poll.
 */
export function Countdown({ label, awaiting, at }: { label: string; awaiting: (nowMs: number) => boolean; at: (nowMs: number) => number | null }) {
  const now = useConsoleSelect((state) => state.now);
  const panel = useMonkeyPanel();
  const waiting = awaiting(now);
  const wasWaiting = useRef(waiting);
  useEffect(() => {
    if (waiting && !wasWaiting.current) void panel.refreshNode();
    wasWaiting.current = waiting;
  }, [waiting, panel]);
  if (waiting) return <AwaitingCheckpoint label={label} />;
  const target = at(now);
  if (target === null) return null;
  return <CountdownView label={label} target={target} now={now} />;
}

export function CountdownView({ label, target, now }: { label: string; target: number; now: number }) {
  return (
    <span role="timer" aria-live="off" aria-label={`${label} in ${spokenCountdown(target, now)}`} className="ml-auto text-label whitespace-nowrap text-glow tabular-nums">
      Next in {formatCountdown(target, now)}
    </span>
  );
}

/** The countdown's place while the close it counted to waits for the checkpoint that carries the next answer. */
export function AwaitingCheckpoint({ label }: { label: string }) {
  return (
    <span role="timer" aria-label={`${label}: waiting for the checkpoint`} className="ml-auto text-label whitespace-nowrap text-fg-3 tabular-nums">
      Waiting for the checkpoint
    </span>
  );
}

/** The next ten-minute budget, from the last `/v1/monkey` answer; hidden until there is one with an emission schedule. */
export function BudgetCountdown() {
  const emissions = usePanelState().overview.value?.emissions ?? null;
  return <Countdown label="Next budget" awaiting={(now) => budgetAwaitingCheckpoint(emissions, now)} at={(now) => nextBudgetMs(emissions, now)} />;
}

/** The next epoch close, from the last `/v1/monkey` answer; hidden until there is one with a distribution. */
export function CloseCountdown() {
  const distribution = usePanelState().overview.value?.distribution ?? null;
  return <Countdown label="Next epoch close" awaiting={(now) => closeAwaitingCheckpoint(distribution, now)} at={(now) => nextCloseMs(distribution, now)} />;
}
