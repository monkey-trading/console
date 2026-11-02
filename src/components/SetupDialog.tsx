"use client";

/** The setup popup: over any page, the steps a connected wallet still has before it deposits. */

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef } from "react";

import { faucetAvailable } from "@/lib/engine/faucet";
import { setupSteps, stepNumber, type SetupStep } from "@/lib/setup-steps";
import { dismissSetup, setupFacts, setupStepDone, setupVisible } from "@/lib/store/setup";

import { useConsole, useSession } from "./ConsoleProvider";
import { SetupSteps } from "./SetupSteps";

const TITLE: Record<SetupStep, string> = { fund: "Fund with Anvil", declare: "Declaration", authorize: "Authorize this browser" };

/** A modal dialog, open while setup is and a step remains. Closing it, by its button or Escape, lasts for the connection. Focus moves to each step's heading as the one before it finishes. */
export function SetupDialog() {
  const state = useConsole();
  const { store, deploy } = useSession();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const current = useRef<HTMLHeadingElement>(null);
  const title = useId();
  const faucet = faucetAvailable(deploy);
  const steps = setupSteps(setupFacts(state, faucet));
  const step = steps[0];
  const open = setupVisible(state) && step !== undefined;
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  useEffect(() => {
    if (open) current.current?.focus();
  }, [open, step]);
  const done = () => {
    if (setupStepDone(store, faucet) === "funding") router.push("/funding");
  };
  const closed = () => {
    dismissSetup(store);
    // The browser hands focus back to what held it, but finishing setup may have removed that, such as the Deposit tab's Continue setup.
    if (document.activeElement === document.body) document.getElementById("main")?.focus();
  };
  return (
    <dialog ref={dialog} aria-labelledby={title} onClose={closed} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border border-line-2 bg-ink-1 p-0 text-fg backdrop:bg-ink/70">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 id={title} className="text-label tracking-caps text-glow uppercase">Set up your account</h2>
        <button type="button" onClick={() => dismissSetup(store)} className="min-h-11 rounded border border-line-2 px-4 py-1.5 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow">Not now</button>
      </div>
      {open && (
        <ol className="divide-y divide-line">
          {steps.map((name) => (
            <li key={name} aria-current={name === step ? "step" : undefined} className="p-4">
              <h3 ref={name === step ? current : undefined} tabIndex={-1} className={`text-label tracking-caps uppercase outline-none ${name === step ? "text-fg" : "text-fg-3"}`}>
                {steps.length > 1 && `${stepNumber(name, faucet)} · `}{TITLE[name]}
              </h3>
              {name === step && <SetupSteps step={name} onDone={done} />}
            </li>
          ))}
        </ol>
      )}
      {/* The page behind a modal dialog is inert, so what the wallet asks and how a step ended are announced from here too. */}
      <p role="status" className="sr-only">{state.prompt ?? state.toasts.at(-1)?.text}</p>
    </dialog>
  );
}
