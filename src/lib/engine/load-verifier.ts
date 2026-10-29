/** Loads the engine's browser verifier: the pinned `.wasm`, checked against its SHA-256 before it runs. */

import pin from "./wasm-pin.json";
import type { Verifier } from "./verifier";
import { createWasmVerifier, type VerifierModule } from "./wasm-verifier";

export interface LoadDeps {
  /** The `.wasm` bytes, from the app's own origin. */
  fetchWasm(): Promise<Uint8Array<ArrayBuffer>>;
  /** The glue module `wasm-bindgen` generated, imported from the app's own origin. */
  loadGlue(): Promise<VerifierModule>;
  /** Whether the verifier may read a mock attestation: a dev build only. */
  allowMock: boolean;
  /** The SHA-256 the build pins, as lowercase hex; the build's own pin unless a test supplies another. */
  sha256?: string;
}

const toHex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * The verifier, ready to use.
 * Error cases:
 * - the `.wasm` cannot be fetched, or its SHA-256 is not the one this build pins
 */
export async function loadVerifier(deps: LoadDeps): Promise<Verifier> {
  const bytes = await deps.fetchWasm();
  const actual = toHex(await crypto.subtle.digest("SHA-256", bytes));
  const expected = deps.sha256 ?? pin.sha256;
  if (actual !== expected) throw new Error(`The verifier's WebAssembly does not match the build's pin (${actual.slice(0, 12)}… instead of ${expected.slice(0, 12)}…), so it was not run.`);
  const glue = await deps.loadGlue();
  await glue.default({ module_or_path: bytes });
  return createWasmVerifier(glue, deps.allowMock);
}
