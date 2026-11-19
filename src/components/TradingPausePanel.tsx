"use client";

/**
 * The panel over the trading view while trading is paused for a change of trading server: what is happening, what is kept, and the steps
 * the change goes through, each in the state the console has observed; then the resumed title over the ticked steps for a moment before it
 * fades. The polite live region that announces each step is `PauseAnnouncer`'s.
 */

import { useId } from "react";

import { LONG_PAUSE, PAUSE_KEPT, PAUSE_STEPS, PAUSE_TITLE, RESUMED_TITLE, STEP_STATE_WORDS } from "@/lib/trading-pause-words";
import type { PauseView, StepState } from "@/lib/store/trading-pause";

const ALL_DONE = { connect: "done", verify: "done", prices: "done", resume: "done" } as const;

/** The mark beside a step: a tick, a spinner (still under reduced motion), an empty ring, or a cross. */
function StepMark({ state }: { state: StepState }) {
  const ring = "inline-block size-3.5 shrink-0 rounded-full border-2";
  switch (state) {
    case "done":
      return <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0 text-glow"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "current":
      return <span aria-hidden="true" className={`${ring} animate-spin border-glow border-t-transparent`} />;
    case "waiting":
      return <span aria-hidden="true" className={`${ring} border-edge`} />;
    case "failed":
      return <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0 text-ember"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
    default:
      return state satisfies never;
  }
}

const NAME_TONE: Readonly<Record<StepState, string>> = { done: "text-fg-2", current: "font-medium text-fg", waiting: "text-fg-3", failed: "font-medium text-ember" };

/** The panel and its scrim over the paused trading view, for `view`. */
export function TradingPausePanel({ view }: { view: Exclude<PauseView, { kind: "none" }> }) {
  const titleId = useId();
  const steps = view.kind === "paused" ? view.steps : ALL_DONE;
  const fade = `transition-opacity duration-300 ${view.kind === "resumed" && view.leaving ? "opacity-0" : "opacity-100"}`;
  return (
    <>
      {/* The scrim the app's dialogs use, over the paused view in its own colours; `inert` on the panes, not this, stops presses. */}
      <div aria-hidden="true" className={`pointer-events-none absolute inset-0 z-10 bg-ink/70 ${fade}`} />
      {/* On a phone the page scrolls, so the panel stays in the viewport above the bar at the foot, and scrolls itself when text is enlarged. */}
      <div data-pause-panel="" className="pointer-events-none fixed inset-x-0 top-0 bottom-(--bar-height,var(--spacing-bar)) z-20 flex items-center justify-center p-4 lg:absolute lg:inset-0 lg:items-start lg:pt-[12vh]">
        {/* A scrollable region the keyboard reaches; the lint rule allows a labelled region focus. */}
        <div role="region" aria-labelledby={titleId} tabIndex={0} className={`pointer-events-auto max-h-full w-full max-w-lg overflow-y-auto rounded border border-line-2 bg-ink-2 p-5 shadow-platform focus-visible:outline-2 focus-visible:outline-glow ${fade}`}>
          <h2 id={titleId} className="text-lead font-medium text-fg">{view.kind === "resumed" ? RESUMED_TITLE : PAUSE_TITLE}</h2>
          {/* Once trading has resumed, what is kept while it is paused no longer applies. */}
          {view.kind === "paused" && <p className="mt-2 text-data leading-relaxed text-fg-2">{PAUSE_KEPT}</p>}
          <ol className="mt-4 flex flex-col gap-2.5">
            {PAUSE_STEPS.map(({ step, name }) => (
              <li key={step} className="flex items-center gap-3 text-data">
                <StepMark state={steps[step]} />
                <span className={NAME_TONE[steps[step]]}>{name(steps[step])}<span className="sr-only">, {STEP_STATE_WORDS[steps[step]]}</span></span>
              </li>
            ))}
          </ol>
          {view.kind === "paused" && view.failure !== null && <p className="mt-4 text-data leading-relaxed text-ember">{view.failure}</p>}
          {view.kind === "paused" && view.failure === null && view.hold !== null && <p className="mt-4 text-data leading-relaxed text-amber">{view.hold}</p>}
          {view.kind === "paused" && view.failure === null && view.hold === null && view.long && <p className="mt-4 text-data leading-relaxed text-amber">{LONG_PAUSE}</p>}
        </div>
      </div>
    </>
  );
}
