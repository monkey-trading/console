/** What a node that cannot be trusted raises, apart from the check itself, so a screen can tell the refusals apart without loading the verifier. */

import { asSentence } from "../format";
import type { AttestationStatus } from "./attestation";
import { EngineError } from "./client";
import type { OperatorRoute } from "./stats-types";

/** A signed request stopped before it left the page, because the node may not be signed for: unlike a request that went out, it cannot have run. */
export class NotSentError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`Your request was not sent. ${reason}`, options);
    this.name = "NotSentError";
  }
}

/** Something the node sent cannot be trusted; the reason is written for the user. */
export class UntrustedError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(reason, options);
    this.name = "UntrustedError";
  }
}

/** An answer with no signature: the node signs nothing while it cannot bound its own clock, so whatever answered cannot currently be verified. */
export class UnsignedAnswer extends UntrustedError {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsignedAnswer";
  }
}

/** A signed answer that verified but that the console refuses to take as the node's word on the vault's signer; `answer` is what it said, which can still say where the operator now runs. */
export class RefusedAnswer extends UntrustedError {
  constructor(reason: string, readonly answer: OperatorRoute) {
    super(reason);
    this.name = "RefusedAnswer";
  }
}

/** A signed answer that verified under `signer`, a key put aside while it was in flight: refused to its caller, while `body`, its JSON, can still say what it named of the vault's signer (monkey-trading/console#377). */
export class SupersededAnswer extends UntrustedError {
  constructor(reason: string, readonly body: unknown, readonly signer: string) {
    super(reason);
    this.name = "SupersededAnswer";
  }
}

/** An answer whose signature does not verify under the trusted address: a forgery, a replay, or a restarted enclave. */
export class SignatureError extends UntrustedError {
  constructor(reason: string) {
    super(reason);
    this.name = "SignatureError";
  }
}

/** Why a quote that verified is not trusted to sign for: no wallet has read the vault. */
export const CONNECT_TO_CHECK = "Connect a wallet to complete verification. Your wallet will check the server against the on-chain vault that holds deposits, and you can trade and move funds once that check succeeds.";

/** Why a wallet's read of the vault could not judge the server, with `reason` as a sentence of its own. */
export const vaultUnchecked = (reason: string): string => `Your wallet could not check the server against the vault. ${asSentence(reason)}`;

/** Why a signed request may not leave under `status`, as a sentence, or null when it may: only a verdict that read the vault, or a dev build's mock, signs. */
export function sendRefusal(status: AttestationStatus): string | null {
  switch (status.kind) {
    case "verified":
    case "mock":
      return null;
    case "attested":
      return status.why;
    case "unverified":
      return status.reason;
    case "clock":
      return `Your device clock differs from the server's time by ${Math.round(Math.abs(status.skewMs) / 1000)} seconds. Correct the clock and reload the page.`;
    case "checking":
    case "reverifying":
      return "The server has not yet been verified.";
    default: {
      const unhandled: never = status;
      throw new Error(`Unknown attestation status: ${String(unhandled)}`);
    }
  }
}

/**
 * Whether `error` says the node is not serving yet rather than that it cannot be trusted: no answer, a gateway in front of it that could not
 * reach it, or an answer it did not sign, as a node does until its time is confirmed. A server that has just taken over is like this for a
 * moment; nothing it says is trusted either way.
 */
export function notReady(error: unknown): boolean {
  return error instanceof UnsignedAnswer || (error instanceof EngineError && (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504));
}
