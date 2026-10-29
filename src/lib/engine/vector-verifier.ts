/**
 * Tests only. A verifier that answers from the engine's known-answer vectors (engine-wire's
 * `vectors.json`, signed by the published mock enclave key) instead of checking signatures: it
 * accepts a response or frame exactly when it equals a vector the engine marks valid. It stands in
 * for the real verifier, so the console's handling of tampered, replayed and misdirected answers
 * runs against real signed bytes without computing a digest here.
 */

import vectors from "./wire-vectors.json";
import type { Check, FrameChecker, FrameConnection, ResponseCheck, Verifier } from "./verifier";
import type { SignedFrame } from "./wire";

interface VectorResponse {
  name: string; chain_id: number; vault: string; challenge: string; method: string; path_and_query: string; request_body: string;
  status: number; time_ms: number; head_seq: number; body: string; signature: string; error: string | null;
}
interface VectorConnection {
  name: string; chain_id: number; vault: string; challenge: string; path_and_query: string; error: string | null;
  frames: SignedFrame[];
}

export const VECTORS = vectors as unknown as { signer: string; responses: VectorResponse[]; connections: VectorConnection[] };
const decoder = new TextDecoder();
const REFUSED: Check = { ok: false, reason: "no known answer matches" };

export function vectorResponse(name: string): VectorResponse {
  const found = VECTORS.responses.find((r) => r.name === name);
  if (!found) throw new Error(`no vector response named ${name}`);
  return found;
}

export function vectorConnection(name: string): VectorConnection {
  const found = VECTORS.connections.find((c) => c.name === name);
  if (!found) throw new Error(`no vector connection named ${name}`);
  return found;
}

/** With `anyPath`, a connection opened with any path stands in for the vectors', whose `after` comes first in the query. */
export function vectorVerifier(options: { anyPath?: boolean } = {}): Verifier {
  return {
    name: "vectors",
    checksSignatures: true,
    verifyAttestation: async () => ({ ok: false, reason: "The vectors carry no attestation." }),
    verifyResponse(response: ResponseCheck): Check {
      const match = VECTORS.responses.some((v) => v.error === null && v.chain_id === response.chainId && v.vault === response.vault && VECTORS.signer === response.signer
        && v.challenge === response.challenge && v.method === response.method && v.path_and_query === response.pathAndQuery && v.request_body === decoder.decode(response.requestBody)
        && v.status === response.status && v.time_ms === response.timeMs && v.head_seq === response.seq && v.body === decoder.decode(response.body) && v.signature === response.signature);
      return match ? { ok: true } : REFUSED;
    },
    openFrames(connection: FrameConnection): FrameChecker {
      let candidates = VECTORS.connections.filter((v) => v.error === null && v.chain_id === connection.chainId && v.vault === connection.vault && VECTORS.signer === connection.signer
        && v.challenge === connection.challenge && (options.anyPath === true || v.path_and_query === connection.pathAndQuery));
      let next = 0;
      return {
        verify(frame: SignedFrame): Check {
          candidates = frame.n === next ? candidates.filter((v) => { const f = v.frames[frame.n]; return f !== undefined && f.time === frame.time && f.msg === frame.msg && f.sig === frame.sig; }) : [];
          next++;
          return candidates.length > 0 ? { ok: true } : REFUSED;
        },
      };
    },
  };
}
