"use client";

/** The eligibility declaration every account signs before its first deposit. */

import { useId, useState } from "react";

import type { EligibilityClass } from "@/lib/engine/types";
import { attestEligibility, STATEMENTS } from "@/lib/store/actions";

import { useConsole, useSession } from "./ConsoleProvider";

const CLASSES: readonly EligibilityClass[] = ["professional", "eligible_client"];

export function EligibilityCard() {
  const { wallet, eligibility, busy } = useConsole();
  const { store } = useSession();
  const [choice, setChoice] = useState<EligibilityClass>("professional");
  const name = useId();
  return (
    <section aria-labelledby="eligibility-title" className="rounded-xl border border-line-2 bg-ink-1 p-5">
      <h2 id="eligibility-title" className="text-label tracking-caps text-fg-3 uppercase">1 · Eligibility</h2>
      {eligibility ? (
        <p className="mt-4 text-caption text-glow">Recorded: {STATEMENTS[eligibility]} You can deposit.</p>
      ) : (
        <form className="mt-4" onSubmit={(event) => { event.preventDefault(); void attestEligibility(store, choice); }}>
          <p className="text-caption leading-relaxed text-fg-2">Before your first deposit you declare, with your wallet, that you are a professional or eligible client. The declaration is recorded in the public log against your account.</p>
          <fieldset className="mt-4 space-y-2">
            <legend className="sr-only">Client class</legend>
            {CLASSES.map((cls) => (
              <label key={cls} className="flex items-start gap-3 rounded border border-line-2 px-3 py-3 text-caption text-fg-2 has-checked:border-glow has-checked:text-fg">
                <input type="radio" name={name} checked={choice === cls} onChange={() => setChoice(cls)} className="mt-0.5 accent-glow" />
                {STATEMENTS[cls]}
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={!wallet || busy} className="mt-4 rounded border border-glow bg-glow/10 px-4 py-2.5 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow disabled:cursor-not-allowed disabled:border-line-2 disabled:bg-transparent disabled:text-fg-3">
            {busy ? "Signing…" : "Sign the declaration"}
          </button>
          {!wallet && <p className="mt-2 text-label text-fg-3">Connect a wallet first.</p>}
        </form>
      )}
    </section>
  );
}
