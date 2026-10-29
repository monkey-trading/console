/**
 * Tests only: the engine's known-answer vectors (engine-wire's `vectors.json`, signed by the
 * published mock enclave key) and the real verifier loaded from the vendored `.wasm`, so the
 * console's handling of tampered, replayed and misdirected answers runs against real signatures.
 */

import { readFile } from "node:fs/promises";

import vectors from "./wire-vectors.json";
import { loadVerifier } from "./load-verifier";
import type { Verifier } from "./verifier";
import type { SignedFrame } from "./wire";

interface VectorResponse {
  name: string; chain_id: number; vault: string; challenge: string; method: string; path_and_query: string; request_body: string;
  status: number; time_ms: number; head_seq: number; body: string; signature: string; error: string | null;
}
interface VectorConnection {
  name: string; chain_id: number; vault: string; challenge: string; path_and_query: string; error: string | null; frames: SignedFrame[];
}

export const VECTORS = vectors as unknown as { signer: string; responses: VectorResponse[]; connections: VectorConnection[] };

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

/** The vendored `.wasm` bytes. */
export const readWasm = async () => new Uint8Array(await readFile(new URL("../../../public/engine-verify/engine_verify_bg.wasm", import.meta.url)));

/** The glue, from the app's public directory as the browser imports it. */
export const loadGlue = () => import("../../../public/engine-verify/engine_verify.js");

/** The real verifier, with the dev-only mock entry point unless `allowMock` is false. */
export const realVerifier = (allowMock = true): Promise<Verifier> => loadVerifier({ allowMock, fetchWasm: readWasm, loadGlue });
