/** The console's check of a node's attestation, which must pass before it signs anything for the node. */

import type { Attestation } from "./types";

export type AttestationStatus =
  | { kind: "checking" }
  /** The node's own mock quote, accepted only where the build allows it. */
  | { kind: "mock" }
  /** A hardware quote that verified against a pinned release manifest. */
  | { kind: "verified"; release: string; config: string; address: string }
  /** The enclave changed or a signature failed, and the console is checking the node again. */
  | { kind: "reverifying" }
  /** The device clock and the verified enclave's signed time disagree, so nothing the node says can be judged. */
  | { kind: "clock"; skewMs: number }
  /** A quote this build cannot verify, or one that fails its checks. Nothing is signed for the node. */
  | { kind: "unverified"; reason: string };

/** Whether the node's feed is arriving: `stale` from the moment the stream fails a check, closes, or goes three heartbeat intervals without a valid frame, until the next valid frame. */
export type FeedStatus = "connecting" | "live" | "stale";

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
    if (!isMockQuote) return { kind: "unverified", reason: "The node claims a mock provider but its quote is not the mock marker." };
    if (!acceptsMock) return { kind: "unverified", reason: "The node presents a mock attestation, which this build refuses." };
    return { kind: "mock" };
  }
  if (isMockQuote) return { kind: "unverified", reason: "The node's quote is the mock marker under a hardware provider name." };
  return null;
}

/** Why the console may not sign now, as a clause, or null when it may: the node is attested and its feed is arriving. */
export function signBlock(status: AttestationStatus, feed: FeedStatus): string | null {
  if (status.kind === "clock") return "your device clock differs from the node's signed time";
  if (status.kind === "reverifying") return "the node is being verified again";
  if (status.kind !== "mock" && status.kind !== "verified") return "the node's attestation is not verified";
  if (feed === "stale") return "the node's feed is stale";
  return feed === "connecting" ? "the node's feed has not started yet" : null;
}

/** Whether the console may sign a request now. */
export function maySign(status: AttestationStatus, feed: FeedStatus): boolean {
  return signBlock(status, feed) === null;
}
