"use client";

/** A quiet countdown to a time on the node's clock, such as the next MONKEY budget; nothing when the time is unknown. */

import { formatCountdown, nextBudgetMs, nextCloseMs, spokenCountdown } from "@/lib/monkey/countdown";

import { useConsoleSelect, usePanelState } from "./use-monkey";

/**
 * `at` computes the target from the clock, so a time already passed rolls on to the next. The clock
 * is the console's sequenced one, never the device's, and the redraw is that clock's own tick: no read.
 * The spoken label changes once a minute; the element is no live region, so nothing is announced.
 */
export function Countdown({ label, at }: { label: string; at: (nowMs: number) => number | null }) {
  const now = useConsoleSelect((state) => state.now);
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

/** The next ten-minute budget, from the last `/v1/monkey` answer; hidden until there is one with an emission schedule. */
export function BudgetCountdown() {
  const emissions = usePanelState().overview.value?.emissions ?? null;
  return <Countdown label="Next budget" at={(now) => nextBudgetMs(emissions, now)} />;
}

/** The next epoch close, from the last `/v1/monkey` answer; hidden until there is one with a distribution. */
export function CloseCountdown() {
  const distribution = usePanelState().overview.value?.distribution ?? null;
  return <Countdown label="Next epoch close" at={(now) => nextCloseMs(distribution, now)} />;
}
