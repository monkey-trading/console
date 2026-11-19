/** What the paused trading view says: its title, what is kept, each step's name, a long pause, and what the live region announces. */

import type { PauseStep, PauseView, StepState } from "./store/trading-pause";

export const PAUSE_TITLE = "Trading is paused while the trading server changes";
export const RESUMED_TITLE = "Trading has resumed";
export const PAUSE_KEPT = "Your positions, working orders, and take-profit and stop-loss levels are kept, and no order is executed until the trading server receives live prices again.";
export const LONG_PAUSE = "The change is taking longer than usual. Trading will resume automatically once it is complete.";

/** The steps in order, each with its name in the state it is in. */
export const PAUSE_STEPS: readonly { step: PauseStep; name: (state: StepState) => string }[] = [
  { step: "connect", name: () => "Connecting to the next trading server" },
  { step: "verify", name: () => "Verifying the trading server" },
  { step: "prices", name: () => "Restoring live prices" },
  { step: "resume", name: (state) => (state === "done" ? "Trading resumed" : "Resuming trading") },
];

/** How a screen reader hears each state beside the step's name. */
export const STEP_STATE_WORDS: Readonly<Record<StepState, string>> = { done: "completed", current: "in progress", waiting: "not yet started", failed: "failed" };

/** What the polite live region says of `view`: the step under way, the title with the first, why a step failed, a long pause, or that trading resumed. */
export function pauseAnnouncement(view: PauseView): string {
  if (view.kind === "none") return "";
  if (view.kind === "resumed") return "Trading resumed.";
  if (view.failure !== null) return view.failure;
  const current = PAUSE_STEPS.find(({ step }) => view.steps[step] === "current");
  const step = current === undefined ? "" : `${current.name("current")}.`;
  if (view.long) return `${LONG_PAUSE} ${step}`.trim();
  return current?.step === "connect" ? `${PAUSE_TITLE}. ${step}` : step;
}
