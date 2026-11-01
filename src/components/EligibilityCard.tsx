"use client";

/** The eligibility declaration every account signs before its first deposit. */

import { useId, useRef, useState } from "react";

import type { EligibilityClass } from "@/lib/engine/types";
import { attestEligibility, STATEMENTS } from "@/lib/store/actions";

import { useConsole, useSession } from "./ConsoleProvider";
import { useSignGate } from "./SignGate";

const CLASSES: readonly EligibilityClass[] = ["professional", "eligible_client"];

/** `step` is the section's place in the Deposit tab. */
export function EligibilityCard({ step }: { step: number }) {
  const { wallet, eligibility, busy, signatures, account } = useConsole();
  const { store } = useSession();
  const [choice, setChoice] = useState<EligibilityClass>("professional");
  const name = useId();
  const gate = useSignGate(`${name}-gate`);
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <section aria-labelledby="eligibility-title" className="p-4">
      <h4 ref={heading} id="eligibility-title" tabIndex={-1} className="text-label tracking-caps text-fg-3 uppercase outline-none">{step} · Eligibility</h4>
      {eligibility ? (
        <p className="mt-3 text-caption text-glow">Recorded: {STATEMENTS[eligibility]} {signatures === "none" ? "You can deposit." : "The node credits your deposits once its screening clears them."}</p>
      ) : (
        <form className="mt-3" onSubmit={(event) => { event.preventDefault(); if (!wallet || busy || gate.blocked) return; void attestEligibility(store, choice).then(() => heading.current?.focus()); }}>
          <p className="text-caption leading-relaxed text-fg-2">
            {signatures === "none"
              ? "Before your first deposit you declare, with your wallet, that you are a professional or eligible client."
              : "You declare, with your wallet, that you are a professional or eligible client. The node takes a first declaration once a deposit for your account is pending, a few blocks after it is mined, and credits the deposit when the declaration is recorded."}
            {" "}The declaration is recorded in the public log against your account.
          </p>
          {signatures === "checked" && account === null && <p className="mt-2 text-label text-fg-3">Sign it once your deposit is pending, a few blocks after the deposit is mined.</p>}
          <fieldset className="mt-4 space-y-2">
            <legend className="sr-only">Client class</legend>
            {CLASSES.map((cls) => (
              <label key={cls} className="flex min-h-11 items-start gap-3 lg:min-h-0 rounded border border-line-2 px-3 py-3 text-caption text-fg-2 has-checked:border-glow has-checked:text-fg">
                <input type="radio" name={name} checked={choice === cls} onChange={() => setChoice(cls)} className="mt-0.5 accent-glow" />
                {STATEMENTS[cls]}
              </label>
            ))}
          </fieldset>
          <button type="submit" aria-disabled={!wallet || busy || gate.blocked} aria-describedby={gate.describedBy} className="mt-4 min-h-11 rounded border border-glow bg-glow/10 px-4 py-2.5 lg:min-h-0 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3">
            {busy ? "Signing…" : "Sign the declaration"}
          </button>
          {gate.note}
          {!wallet && <p className="mt-2 text-label text-fg-3">Connect a wallet first.</p>}
        </form>
      )}
    </section>
  );
}
