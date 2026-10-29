"use client";

/** The eligibility declaration every account signs before its first deposit. */

import { useId, useRef, useState } from "react";

import { maySign } from "@/lib/engine/attestation";
import type { EligibilityClass } from "@/lib/engine/types";
import { attestEligibility, STATEMENTS } from "@/lib/store/actions";

import { useConsole, useSession } from "./ConsoleProvider";

const CLASSES: readonly EligibilityClass[] = ["professional", "eligible_client"];

export function EligibilityCard() {
  const { wallet, eligibility, busy, attestation, stream } = useConsole();
  const { store } = useSession();
  const [choice, setChoice] = useState<EligibilityClass>("professional");
  const name = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <section aria-labelledby="eligibility-title" className="rounded-xl border border-line-2 bg-ink-1 p-5">
      <h2 ref={heading} id="eligibility-title" tabIndex={-1} className="text-label tracking-caps text-fg-3 uppercase outline-none">1 · Eligibility</h2>
      {eligibility ? (
        <p className="mt-4 text-caption text-glow">Recorded: {STATEMENTS[eligibility]} You can deposit.</p>
      ) : (
        <form className="mt-4" onSubmit={(event) => { event.preventDefault(); if (!wallet || busy || !maySign(attestation, stream)) return; void attestEligibility(store, choice).then(() => heading.current?.focus()); }}>
          <p className="text-caption leading-relaxed text-fg-2">Before your first deposit you declare, with your wallet, that you are a professional or eligible client. The declaration is recorded in the public log against your account.</p>
          <fieldset className="mt-4 space-y-2">
            <legend className="sr-only">Client class</legend>
            {CLASSES.map((cls) => (
              <label key={cls} className="flex min-h-11 items-start gap-3 lg:min-h-0 rounded border border-line-2 px-3 py-3 text-caption text-fg-2 has-checked:border-glow has-checked:text-fg">
                <input type="radio" name={name} checked={choice === cls} onChange={() => setChoice(cls)} className="mt-0.5 accent-glow" />
                {STATEMENTS[cls]}
              </label>
            ))}
          </fieldset>
          <button type="submit" aria-disabled={!wallet || busy || !maySign(attestation, stream)} className="mt-4 min-h-11 rounded border border-glow bg-glow/10 px-4 py-2.5 lg:min-h-0 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3">
            {busy ? "Signing…" : "Sign the declaration"}
          </button>
          {!wallet && <p className="mt-2 text-label text-fg-3">Connect a wallet first.</p>}
        </form>
      )}
    </section>
  );
}
