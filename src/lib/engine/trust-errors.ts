/** What a node that cannot be trusted raises, apart from the check itself, so a screen can tell the refusals apart without loading the verifier. */

/** A signed request stopped before it left the page, because the node may not be signed for: unlike a request that went out, it cannot have run. */
export class NotSentError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`Nothing was sent. ${reason}`, options);
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

/** An answer whose signature does not verify under the trusted address: a forgery, a replay, or a restarted enclave. */
export class SignatureError extends UntrustedError {
  constructor(reason: string) {
    super(reason);
    this.name = "SignatureError";
  }
}

/** Why a quote that verified is not trusted to sign for: no wallet has read the vault. */
export const CONNECT_TO_CHECK = "Connect a wallet to check the vault's current release before anything is signed.";
