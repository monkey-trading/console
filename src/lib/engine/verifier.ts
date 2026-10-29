/**
 * What the console needs from the engine's verifier (engine-verify and engine-wire, built for the
 * browser): the attestation check, the signed-response check, and the signed-frame check. The
 * console never computes a digest or recovers a signature itself.
 */

import type { Attestation } from "./types";
import type { SignedFrame } from "./wire";

/** `GET /v1/attestation/collateral`: the chip's certificate, the vendor chain, and the revocation list. */
export interface Collateral {
  vcek: string;
  intermediate: string;
  root: string;
  crl: string;
  fetched_at: number;
}

/** What a verified attestation says about the enclave. */
export interface VerifiedAttestation {
  /** The enclave address that signs the node's answers. */
  address: string;
  release: string;
  config: string;
  tlsKeyHash: string;
  /** The window the vendor chain is valid in, in milliseconds since the epoch. */
  validFromMs: number;
  validToMs: number;
}

export type Check = { ok: true } | { ok: false; reason: string };

/** A signed response as the console received it, with the request it answers. */
export interface ResponseCheck {
  signer: string;
  chainId: number;
  vault: string;
  /** The challenge this client sent, never the one the response echoes. */
  challenge: string;
  method: string;
  pathAndQuery: string;
  requestBody: Uint8Array;
  status: number;
  timeMs: number;
  seq: number;
  body: Uint8Array;
  signature: string;
}

/** The connection a stream's frames belong to. */
export interface FrameConnection {
  signer: string;
  chainId: number;
  vault: string;
  challenge: string;
  /** The path and query of the request that opened the connection, as sent. */
  pathAndQuery: string;
}

/** Checks one connection's frames in the order they arrive, from `n` 0; once a frame fails, so does every later one. */
export interface FrameChecker {
  verify(frame: SignedFrame): Check;
}

export interface Verifier {
  readonly name: string;
  /** False for a stand-in that accepts anything: the screens then say signatures are not verified. */
  readonly checksSignatures: boolean;
  verifyAttestation(input: {
    attestation: Attestation;
    collateral: Collateral | null;
    manifests: readonly string[];
    nowMs: number;
  }): Promise<{ ok: true; attested: VerifiedAttestation } | { ok: false; reason: string }>;
  verifyResponse(response: ResponseCheck): Check;
  openFrames(connection: FrameConnection): FrameChecker;
}

/** Refuses everything: the verifier of a build that has none, so it trusts no node. */
export const unavailableVerifier: Verifier = {
  name: "none",
  checksSignatures: true,
  verifyAttestation: async () => ({ ok: false, reason: "This build has no attestation verifier, so it cannot trust a node." }),
  verifyResponse: () => ({ ok: false, reason: "This build has no signature verifier." }),
  openFrames: () => ({ verify: () => ({ ok: false, reason: "This build has no signature verifier." }) }),
};
