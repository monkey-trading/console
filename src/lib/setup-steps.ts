/**
 * The setup a connected wallet goes through before it deposits (monkey-trading/console#168): which
 * steps remain, in order, and what a screen says while one is missing. The engine takes a declaration
 * and a session key before any deposit (monkey-trading/engine#470).
 */

import { FAUCET_USDC } from "./engine/faucet-gate";
import { MAX_SESSION_KEYS_PER_ACCOUNT } from "./engine/session-key-limits";
import type { EligibilityClass, Reject } from "./engine/types";
import type { Fixed } from "./fixed";
import { formatStamp } from "./time";
import { formatUsdc } from "./vault";

/** A step of the setup popup. */
export type SetupStep = "fund" | "declare" | "authorize" | "deposit";

/** What the steps depend on. */
export interface SetupFacts {
  /** Whether this build has the dev faucet. */
  faucet: boolean;
  /** How the faucet step ended on this connection, or null. */
  fund: "minted" | "skipped" | null;
  /** What the wallet holds on the custody chain, when it has been read. */
  walletHolds: Fixed | null;
  /** Whether the node has credited the account. */
  credited: boolean;
  /** The recorded declaration, or null. */
  declared: EligibilityClass | null;
  /** When this browser's live session key stops being accepted, or null with none. */
  keyUntil: number | null;
  /** The deposit this connection's wallet sent, and whether the node has credited it since. */
  deposit: { amount: Fixed; credited: boolean } | null;
}

/** What says whether a screen waits on setup, from the console's state. */
export interface SetupView {
  wallet: { readOnly?: boolean } | null;
  accountRead: boolean;
  eligibility: string | null;
  setup: { decided: boolean };
}

/** One step as the popup lists it: done with what to say of it, or still to do. */
export interface StepView {
  step: SetupStep;
  done: boolean;
  /** A line for a done step; generic when this connection did not do the step itself, such as an account funded before. */
  summary: string | null;
}

const CLASS_LABEL: Record<EligibilityClass, string> = { professional: "Professional client", eligible_client: "Eligible client" };

/** Every step this build has, in order, each with whether it is done; the first that is not is the current one. */
export function setupSteps(facts: SetupFacts): readonly StepView[] {
  const held = facts.walletHolds !== null && facts.walletHolds > 0n;
  const deposited = facts.deposit?.credited === true || (facts.deposit === null && facts.credited);
  const steps: StepView[] = [
    ...(facts.faucet ? [{
      step: "fund" as const,
      done: facts.fund !== null || held || facts.credited,
      summary: !(facts.fund !== null || held || facts.credited) ? null : facts.fund === "minted" ? `${formatUsdc(FAUCET_USDC)} minted` : facts.fund === "skipped" ? "Skipped" : held && facts.walletHolds !== null ? `Wallet holds ${formatUsdc(facts.walletHolds)}` : "Account already funded",
    }] : []),
    { step: "declare", done: facts.declared !== null, summary: facts.declared === null ? null : CLASS_LABEL[facts.declared] },
    { step: "authorize", done: facts.keyUntil !== null, summary: facts.keyUntil === null ? null : `This browser can trade until ${formatStamp(facts.keyUntil)} UTC` },
    { step: "deposit", done: deposited, summary: !deposited ? null : facts.deposit === null ? "Account funded" : `${formatUsdc(facts.deposit.amount)} deposited` },
  ];
  return steps;
}

/** The step the popup expands: the first not done, or null once all are. */
export const currentStep = (steps: readonly StepView[]): SetupStep | null => steps.find((s) => !s.done)?.step ?? null;

/** A step's number among the steps this build has; numbers stay put as earlier steps finish. */
export const stepNumber = (step: SetupStep, faucet: boolean): number => (faucet ? ["fund", "declare", "authorize", "deposit"] : ["declare", "authorize", "deposit"]).indexOf(step) + 1;

/** Whether the session key is live by the sequenced clock. */
export const keyLive = (view: { now: number; sessionExpiresAt: number }): boolean => view.sessionExpiresAt > view.now;

/**
 * What a screen that needs setup shows: `reading` until the connected account has been read, so a
 * declared account never shows a step it has done; `needed` while no declaration is recorded; null
 * when nothing waits. A declared account without a live key is not setup's business: its wallet is
 * asked for the signature when it connects, and again when an order needs it. A read-only account
 * has no setup, and neither does a page's starting demo account, before its connect has decided anything.
 */
export function setupGate(view: SetupView): "reading" | "needed" | null {
  if (view.wallet === null || view.wallet.readOnly === true) return null;
  if (!view.accountRead) return "reading";
  if (!view.setup.decided) return null;
  return view.eligibility === null ? "needed" : null;
}

/** Whether revoking a key would clear this refusal: the live-key cap would, and the engine's budget of new keys would not. */
export const revokeClears = (reject: Reject): boolean => reject.kind === "too_many_session_keys" && reject.max === MAX_SESSION_KEYS_PER_ACCOUNT;
