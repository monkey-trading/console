/** The console's check of a node's attestation, which must pass before it signs anything for the node. */

import { signerClause } from "./signer-naming";
import type { Attestation } from "./types";

export type AttestationStatus =
  | { kind: "checking" }
  /** The node's own mock quote, accepted only where the build allows it. */
  | { kind: "mock" }
  /** A hardware quote that verified against a pinned release and the vault's current release, from the vault's signer. */
  | { kind: "verified"; release: string; config: string; address: string }
  /** A hardware quote whose code, policy and TCB verified against a pinned release, with the vault's current release not read: answers may be read and nothing is signed. `why` says what the read needs. */
  | { kind: "attested"; release: string; address: string; why: string }
  /** The enclave changed or a signature failed, and the console is checking the node again. */
  | { kind: "reverifying" }
  /** The device clock and the verified enclave's signed time disagree, so nothing the node says can be judged. */
  | { kind: "clock"; skewMs: number }
  /** A quote this build cannot verify, or one that fails its checks. Nothing is signed for the node. */
  | { kind: "unverified"; reason: string };

/** Whether the node's feed is arriving: `stale` from the moment the stream fails a check, closes, or goes three heartbeat intervals without a valid frame, until the next valid frame. */
export type FeedStatus = "connecting" | "live" | "stale";

/** What the console says when a build that refuses mock attestations meets one. */
export const MOCK_REFUSED = "This server is a test server that can't be verified, so this version of the app won't use it.";
const MOCK_QUOTE_PREFIX = "MOCK-ATTESTATION-NOT-A-TEE:";

function hexToText(hex: string): string | null {
  const digits = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (digits.length % 2 !== 0 || /[^0-9a-f]/i.test(digits)) return null;
  let out = "";
  for (let i = 0; i < digits.length; i += 2) out += String.fromCharCode(parseInt(digits.slice(i, i + 2), 16));
  return out;
}

/**
 * Judges a quote the console can decide alone: the node's mock quote, accepted only when
 * `acceptsMock`, and a quote that lies about being one. Null for a hardware quote, which only the
 * engine's verifier can judge.
 */
export function checkAttestation(attestation: Attestation, acceptsMock: boolean): AttestationStatus | null {
  const quote = hexToText(attestation.quote);
  const isMockQuote = quote !== null && quote.startsWith(MOCK_QUOTE_PREFIX);
  if (attestation.provider === "mock") {
    if (!isMockQuote) return { kind: "unverified", reason: "This server says it is a test server, but its verification data doesn't match one." };
    if (!acceptsMock) return { kind: "unverified", reason: MOCK_REFUSED };
    return { kind: "mock" };
  }
  if (isMockQuote) return { kind: "unverified", reason: "This server says it runs on secure hardware, but its verification data is a test server's." };
  return null;
}

/**
 * The enclave whose answers the console is reading: the verified signer's address, lowercased, or
 * `"mock"` for the mock node; null while no enclave is verified. Two statuses that name the same
 * address are the same enclave, whether or not the vault's release was also checked.
 */
export function enclaveOf(status: AttestationStatus): string | null {
  if (status.kind === "mock") return "mock";
  return status.kind === "verified" || status.kind === "attested" ? status.address.toLowerCase() : null;
}

/** Why the console may not sign now, as a clause, or null when it may: the account can sign, the node is attested and its feed is arriving. */
export function signBlock(status: AttestationStatus, feed: FeedStatus, readOnly = false): string | null {
  if (readOnly) return "this account is read-only, so it can't sign anything";
  if (status.kind === "clock") return "your device clock is wrong";
  if (status.kind === "attested") return "this server hasn't been checked against the vault yet";
  return readBlock(status, feed);
}

/** Why the node's answers may not be read now, as a clause, or null when they may: a verified attestation of the pinned code is enough to read, and only the vault's release to sign. */
export function readBlock(status: AttestationStatus, feed: FeedStatus): string | null {
  if (status.kind === "clock") return "your device clock is wrong";
  if (status.kind === "reverifying") return "the server is being verified again";
  if (status.kind === "unverified") return signerClause(status.reason) ?? "the server couldn't be verified";
  if (status.kind !== "mock" && status.kind !== "verified" && status.kind !== "attested") return "the server hasn't been verified yet";
  if (feed === "stale") return "prices aren't updating";
  return feed === "connecting" ? "live prices haven't started yet" : null;
}
