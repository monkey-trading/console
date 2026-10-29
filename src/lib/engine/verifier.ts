/**
 * What the console needs from the engine's browser verifier (`engine-verify` and `engine-wire`,
 * built for WebAssembly): the attestation check, the signed-response check, and the signed-frame
 * check. The console never computes a digest or recovers a signature itself; it passes the texts,
 * header values and bodies exactly as received.
 */

export type Verdict<T> = ({ ok: true } & T) | { ok: false; reason: string };

/** What a verified attestation says about the enclave. */
export interface AttestedEnclave {
  /** The enclave address that signs the node's answers, `0x` and 40 lowercase hex digits. */
  address: string;
  /** The release manifest that admitted the quote; null for a mock attestation. */
  release: string | null;
  config: string | null;
}

export interface AttestationInput {
  /** The `/v1/attestation` JSON text. */
  attestation: string;
  /** The pinned `release.toml` texts. */
  manifests: readonly string[];
  /** The `/v1/attestation/collateral` JSON text. */
  collateral: string;
  nowMs: number;
}

/** A signed response as the console received it, with the request it answers. */
export interface ResponseInput {
  signer: string;
  chainId: number;
  vault: string;
  /** The challenge this client sent, never the one the response echoes. */
  challenge: string;
  method: string;
  pathAndQuery: string;
  requestBody: Uint8Array;
  status: number;
  /** The four `X-Engine-*` header values, null when absent. */
  signature: string | null;
  time: string | null;
  seq: string | null;
  echoedChallenge: string | null;
  body: Uint8Array;
}

/** What a verified response's signature vouches for besides its body. */
export interface VerifiedResponse {
  /** The node's time when it answered, in milliseconds. */
  timeMs: number;
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

/** Checks one connection's frames in the order received; once a frame fails, so does every later one. */
export interface FrameChecker {
  /** `text` is the frame as received; the verdict carries its message as JSON text. */
  verify(text: string): Verdict<{ msg: string }>;
}

export interface Verifier {
  verifyAttestation(input: AttestationInput): Verdict<{ enclave: AttestedEnclave }>;
  /**
   * Development only: reads a mock attestation, which proves no enclave. Absent from the verifier of
   * a build that must never accept one, so such a build cannot call it.
   */
  verifyMockAttestation?: (attestation: string) => Verdict<{ enclave: AttestedEnclave }>;
  verifyResponse(input: ResponseInput): Verdict<{ response: VerifiedResponse }>;
  openFrames(connection: FrameConnection): FrameChecker;
}
