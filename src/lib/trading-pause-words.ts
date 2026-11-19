/** What the paused trading view says: its title, what is kept, each step's name, a long pause, and what the live region announces. */

import type { PauseStep, PauseView, StepState } from "./store/trading-pause";

export const PAUSE_TITLE = "Trading is paused while the trading server changes";
export const RESUMED_TITLE = "Trading has resumed";
export const PAUSE_KEPT = "Your positions, working orders, and take-profit and stop-loss levels are kept, and no order is executed until the trading server receives live prices again.";
export const LONG_PAUSE = "The change is taking longer than usual. Trading will resume automatically once it is complete.";
/** What a pause expects to end it, on a page without the trading view. */
export const RESUMES_WHEN = "Trading will resume automatically once the new server has been verified and live prices have returned.";
/** What the deal ticket says while the trading server changes, whether or not the server in use still trades. */
export const ORDERS_PAUSED = "New orders are paused while the trading server changes. They will be accepted again automatically once the new server has been verified and live prices have returned.";

/** A failed step's words: what happened and what follows, with no chain of reasons; why a server was refused is the verifier's detail. */
export const NEXT_REFUSED = "The next trading server could not be verified, so the app has not connected to it.";
export const SERVER_REFUSED = "The trading server could not be verified.";
export const STILL_PAUSED = "Trading remains paused, and the app will try again automatically.";
export const UNLISTED_NEXT = "This version of the app does not recognise the next trading server, so it cannot connect to it. Trading remains paused. Reload the page to use the latest version of the app.";
export const WALLET_HOLD = "A request you sent is still in progress. The change will complete once it has finished, or once you have confirmed or rejected it in your wallet.";
export const CLOCK_WRONG = "Your device clock is incorrect, so the trading server cannot be verified.";
export const CLOCK_FIX = "Correct the clock and reload the page.";
export const CLOCK_FAILED = `${CLOCK_WRONG} Trading remains paused. ${CLOCK_FIX}`;
/** While the server in use still trades and the next one is on its way: what still works. */
export const CLOSES_STILL_OPEN = "New orders are paused until the change is complete, but you can still close positions and cancel working orders.";
export const ORDERS_STILL_PAUSED = "New orders remain paused, and the app will try again automatically.";

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
  if (view.hold !== null) return view.hold;
  const current = PAUSE_STEPS.find(({ step }) => view.steps[step] === "current");
  const step = current === undefined ? "" : `${current.name("current")}.`;
  if (view.long) return `${LONG_PAUSE} ${step}`.trim();
  return current?.step === "connect" ? `${PAUSE_TITLE}. ${step}` : step;
}
