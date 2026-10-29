/** The engine's browser verifier, wrapped to the console's `Verifier` interface. */

import type * as Glue from "../../../public/engine-verify/engine_verify";
import type { FrameConnection, Verdict, Verifier } from "./verifier";

/** The module `wasm-bindgen` generated, after `init` ran. */
export type VerifierModule = typeof Glue;

/** Runs a check that throws its message as a string, as the verifier's checks do. */
function judge<T extends object>(check: () => T): Verdict<T> {
  try {
    return { ok: true, ...check() };
  } catch (error) {
    // The verifier throws a string; anything else is a defect worth showing as it is.
    return { ok: false, reason: typeof error === "string" ? error : error instanceof Error ? error.message : "The verifier failed." };
  }
}

/**
 * `allowMock` adds the development-only mock entry point; leave it off in a build that must never
 * accept a mock attestation.
 */
export function createWasmVerifier(wasm: VerifierModule, allowMock: boolean): Verifier {
  const enclave = (attested: { enclaveAddress: string; releaseName?: string; configName?: string }) => ({
    enclave: { address: attested.enclaveAddress, release: attested.releaseName ?? null, config: attested.configName ?? null },
  });
  const verifier: Verifier = {
    verifyAttestation: (input) => judge(() => enclave(wasm.verifyAttestation(input.attestation, [...input.manifests], input.collateral, input.nowMs))),
    verifyResponse: (input) =>
      judge(() => {
        const expected = new wasm.ExpectedSigner(input.signer, BigInt(input.chainId), input.vault, input.challenge);
        try {
          const verified = wasm.verifyResponse(
            expected, input.method, input.pathAndQuery, input.requestBody, input.status, input.signature, input.time, input.seq, input.echoedChallenge, input.body,
          );
          const timeMs = verified.timeMs;
          verified.free();
          return { response: { timeMs } };
        } finally {
          expected.free();
        }
      }),
    openFrames: (connection: FrameConnection) => {
      const frames = new wasm.FrameVerifier(new wasm.ExpectedSigner(connection.signer, BigInt(connection.chainId), connection.vault, connection.challenge), connection.pathAndQuery);
      return { verify: (text) => judge(() => ({ msg: frames.verifyFrame(text) })) };
    },
  };
  return allowMock ? { ...verifier, verifyMockAttestation: (attestation) => judge(() => enclave(wasm.verifyMockAttestation(attestation))) } : verifier;
}
