/**
 * The setup a connected wallet goes through before it deposits (monkey-trading/console#168): which
 * steps remain, in order, and what a screen says while one is missing. The engine takes a declaration
 * and a session key before any deposit (monkey-trading/engine#470).
 */

import { MAX_SESSION_KEYS_PER_ACCOUNT } from "./engine/session-key";
import type { Reject } from "./engine/types";

/** A step of the setup popup. */
export type SetupStep = "fund" | "declare" | "authorize";

/** What the steps depend on. */
export interface SetupFacts {
  /** Whether this build has the dev faucet. */
  faucet: boolean;
  /** Whether the node has credited the account. */
  credited: boolean;
  /** Whether a declaration is recorded. */
  declared: boolean;
  /** Whether this browser holds a live session key. */
  keyed: boolean;
  /** Whether the faucet step was used or skipped on this connection. */
  fundSettled: boolean;
}

/** What says whether a screen waits on setup, from the console's state. */
export interface SetupView {
  wallet: { readOnly?: boolean } | null;
  accountRead: boolean;
  eligibility: string | null;
  now: number;
  sessionExpiresAt: number;
  sessionRefusal: Reject | null;
  setup: { decided: boolean };
}

/** The steps that remain, in order. The faucet is offered only to an account the node has not credited, until it is used or skipped. */
export function setupSteps(facts: SetupFacts): readonly SetupStep[] {
  return [
    ...(facts.faucet && !facts.credited && !facts.fundSettled ? (["fund"] as const) : []),
    ...(facts.declared ? [] : (["declare"] as const)),
    ...(facts.keyed ? [] : (["authorize"] as const)),
  ];
}

/** A step's number among the steps this build has; numbers stay put as earlier steps finish. */
export const stepNumber = (step: SetupStep, faucet: boolean): number => (faucet ? ["fund", "declare", "authorize"] : ["declare", "authorize"]).indexOf(step) + 1;

/** Whether the session key is live by the sequenced clock. */
export const keyLive = (view: Pick<SetupView, "now" | "sessionExpiresAt">): boolean => view.sessionExpiresAt > view.now;

/**
 * What a screen that needs setup shows: `reading` until the connected account has been read, so a
 * declared account never shows a step it has done; `needed` while a declaration or key is missing;
 * null when nothing waits. A refused registration ends the wait for a key: orders then ask the wallet,
 * so a position can always close and a deposit can always land. A read-only account has no setup, and
 * neither does a page's starting demo account, before its connect has decided anything.
 */
export function setupGate(view: SetupView): "reading" | "needed" | null {
  if (view.wallet === null || view.wallet.readOnly === true) return null;
  if (!view.accountRead) return "reading";
  if (!view.setup.decided) return null;
  return view.eligibility === null || (!keyLive(view) && view.sessionRefusal === null) ? "needed" : null;
}

/** Whether revoking a key would clear this refusal: the live-key cap would, and the engine's budget of new keys would not. */
export const revokeClears = (reject: Reject): boolean => reject.kind === "too_many_session_keys" && reject.max === MAX_SESSION_KEYS_PER_ACCOUNT;
