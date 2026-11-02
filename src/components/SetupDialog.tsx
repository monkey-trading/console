"use client";

/** The setup popup: over any page, the steps a connected wallet with no declaration goes through before it trades, ending in its first deposit. */

import { useEffect, useId, useRef } from "react";

import { faucetAvailable } from "@/lib/engine/faucet";
import { currentStep, setupSteps, stepNumber, type SetupStep } from "@/lib/setup-steps";
import { dismissSetup, setupFacts, setupVisible } from "@/lib/store/setup";

import { useConsole, useSession } from "./ConsoleProvider";
import { SetupSteps } from "./SetupSteps";

const TITLE: Record<SetupStep, string> = { fund: "Fund with Anvil", declare: "Declaration", authorize: "Authorize this browser", deposit: "Deposit" };
const BUTTON = "min-h-11 rounded border px-4 py-1.5 text-caption focus-visible:outline-2 focus-visible:outline-glow";

/** A modal dialog, open while setup is. Every step stays listed: a finished one as a tick and a line, the current one expanded. Closing it, by its button or Escape, lasts for the connection. Focus moves to each step's heading as it becomes current. */
export function SetupDialog() {
  const state = useConsole();
  const { store, deploy } = useSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const title = useId();
  const faucet = faucetAvailable(deploy);
  const steps = setupSteps(setupFacts(state, faucet));
  const current = currentStep(steps);
  // With every step done the deposit is the last word, and carries the way out.
  const focused = current ?? "deposit";
  const finished = current === null;
  // A dev build waits for the wallet's USDC to be read, so the faucet step is never shown before it is known to be done.
  const open = setupVisible(state) && (!faucet || state.walletUsdc.read.status !== "unread");
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open, focused, finished]);
  const closed = () => {
    dismissSetup(store);
    // The browser hands focus back to what held it, but finishing setup may have removed that, such as the Deposit tab's Continue setup.
    if (document.activeElement === document.body) document.getElementById("main")?.focus();
  };
  return (
    <dialog ref={dialog} aria-labelledby={title} onClose={closed} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border border-line-2 bg-ink-1 p-0 text-fg backdrop:bg-ink/70">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 id={title} className="text-label tracking-caps text-glow uppercase">Set up your account</h2>
        <button type="button" onClick={() => dismissSetup(store)} className={`${BUTTON} border-line-2 text-fg-2 hover:border-glow hover:text-glow`}>Not now</button>
      </div>
      {open && (
        <ol className="divide-y divide-line">
          {steps.map(({ step, done, summary }) => (
            <li key={step} aria-current={step === current ? "step" : undefined} className="p-4">
              <h3 ref={step === focused ? heading : undefined} tabIndex={-1} className={`flex items-baseline gap-2 text-label tracking-caps uppercase outline-none ${step === current ? "text-fg" : done ? "text-fg-2" : "text-fg-3"}`}>
                <span>{stepNumber(step, faucet)} · {TITLE[step]}</span>
                {done && <span aria-hidden="true" className="text-glow">✓</span>}
                {done && <span className="sr-only">, done</span>}
              </h3>
              {done && summary !== null && <p className="mt-1 text-caption text-fg-2">{summary}</p>}
              {step === current && <SetupSteps step={step} />}
              {step === "deposit" && current === null && (
                <button type="button" onClick={() => dismissSetup(store)} className={`${BUTTON} mt-4 border-glow bg-glow/10 text-glow hover:bg-glow/20`}>Start trading</button>
              )}
            </li>
          ))}
        </ol>
      )}
      {/* The page behind a modal dialog is inert, so what the wallet asks and how a step ended are announced from here too. */}
      <p role="status" className="sr-only">{state.prompt ?? state.toasts.at(-1)?.text}</p>
    </dialog>
  );
}
