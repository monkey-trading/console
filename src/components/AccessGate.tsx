"use client";

/** Replaces every screen with the geo-block when the node refuses the caller's region. */

import type { ReactNode } from "react";

import { useConsole } from "./ConsoleProvider";

const REASON = {
  united_states: "Monkey Trading is not available to persons in the United States.",
  sanctioned_jurisdiction: "Monkey Trading is not available in sanctioned jurisdictions.",
} as const;

export function AccessGate({ children }: { children: ReactNode }) {
  const { blocked } = useConsole();
  if (blocked === null) return children;
  return (
    <section aria-labelledby="blocked-title" className="mx-auto max-w-xl rounded-xl border border-alarm/50 bg-ink-1 p-8 text-center">
      <p className="text-label tracking-caps text-alarm uppercase">Not available</p>
      <h1 id="blocked-title" className="mt-3 text-lg tracking-tight">This service is not offered where you are</h1>
      <p className="mt-4 text-data leading-relaxed text-fg-2">{REASON[blocked]}</p>
      <p className="mt-4 text-caption leading-relaxed text-fg-3">
        The node decides this from where your connection comes from and refuses every request, including deposits and orders sent straight to the API or the vault. Nothing in this app can change it.
      </p>
    </section>
  );
}
