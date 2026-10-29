"use client";

/** Says under a funding form's button why the console cannot sign now, when it cannot. */

import { signBlock } from "@/lib/engine/attestation";

import { useConsole } from "./ConsoleProvider";

/** The reason signing is blocked, or null, and the element naming it; `id` is for the button's `aria-describedby`. */
export function useSignGate(id: string): { blocked: boolean; describedBy: string | undefined; note: React.ReactNode } {
  const { attestation, stream } = useConsole();
  const why = signBlock(attestation, stream);
  return {
    blocked: why !== null,
    describedBy: why === null ? undefined : id,
    note: why === null ? null : <p id={id} role="status" className="mt-2 text-label leading-relaxed text-amber">The console cannot sign now: {why}.</p>,
  };
}
