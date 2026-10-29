/** The console's check of a node's attestation, which must pass before it signs anything for the node. */

import { MOCK_BUILD } from "../build";
import type { Attestation } from "./types";

export type AttestationStatus =
  | { kind: "checking" }
  /** The node's own mock quote, accepted only by a mock build. */
  | { kind: "mock" }
  /** A quote this build cannot verify, or one that fails its checks. Nothing is signed for the node. */
  | { kind: "unverified"; reason: string };

const MOCK_QUOTE_PREFIX = "MOCK-ATTESTATION-NOT-A-TEE:";

function hexToText(hex: string): string | null {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  let out = "";
  for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/**
 * Judges an attestation. A hardware quote needs the vendor certificate chain and a release
 * manifest, which only `engine verify-attestation` has, so this build never accepts one.
 */
export function checkAttestation(attestation: Attestation): AttestationStatus {
  const quote = hexToText(attestation.quote);
  const isMockQuote = quote !== null && quote.startsWith(MOCK_QUOTE_PREFIX);
  if (attestation.provider === "mock") {
    if (!isMockQuote) return { kind: "unverified", reason: "The node claims a mock provider but its quote is not the mock marker." };
    if (!MOCK_BUILD) return { kind: "unverified", reason: "The node presents a mock attestation, which this build refuses." };
    return { kind: "mock" };
  }
  if (isMockQuote) return { kind: "unverified", reason: "The node's quote is the mock marker under a hardware provider name." };
  return {
    kind: "unverified",
    reason: `The ${attestation.provider} quote cannot be verified here: this build does not check vendor certificate chains or a release manifest.`,
  };
}

/** Whether the console may sign a request for a node with this status. */
export function maySign(status: AttestationStatus): boolean {
  return status.kind === "mock";
}
