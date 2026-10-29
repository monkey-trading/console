"use client";

/** Says under a funding form's button why the console cannot sign now, when it cannot. */

import { signBlock } from "@/lib/engine/attestation";

import { useConsole } from "./ConsoleProvider";

/** The reason signing is blocked, or null, and the element naming it; `id` is for the button's `aria-describedby`. */
export function useSignGate(id: string): { blocked: boolean; describedBy: string | undefined; note: React.ReactNode } {
  const { attestation, stream, wallet } = useConsole();
  const why = signBlock(attestation, stream, wallet?.readOnly === true);
  return {
    blocked: why !== null,
    describedBy: why === null ? undefined : id,
    note: why === null ? null : <p id={id} role="status" className="mt-2 text-label leading-relaxed text-amber">The console cannot sign now: {why}.</p>,
  };
}

/** The line under a table of positions or orders when its account is read-only, and the id its buttons describe themselves by; null for an account that can sign. */
export function useReadOnlyNote(id: string, action: string): { readOnly: boolean; describedBy: string | undefined; note: React.ReactNode } {
  const { wallet } = useConsole();
  const readOnly = wallet?.readOnly === true;
  return {
    readOnly,
    describedBy: readOnly ? id : undefined,
    note: readOnly ? <p id={id} role="status" className="px-4 py-3 text-label leading-relaxed text-amber">{action} is off: this account is read-only, so nothing can be signed for it.</p> : null,
  };
}
