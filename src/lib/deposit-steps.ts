/** The steps of the Deposit tab and their order for a build. */

import type { SignatureChecks } from "./engine/client";

/** A step of the deposit flow. */
export type DepositStep = "deposit" | "eligibility";

/**
 * The steps to show, in order. The engine takes a first declaration once a deposit is pending, so a live
 * node (`checked`) deposits and then declares; the mock asks for the declaration first. A recorded
 * declaration needs no step.
 */
export function depositSteps(signatures: SignatureChecks, declared: boolean): readonly DepositStep[] {
  if (declared) return ["deposit"];
  return signatures === "checked" ? ["deposit", "eligibility"] : ["eligibility", "deposit"];
}
