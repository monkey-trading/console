/**
 * DEV ONLY: a stand-in for the engine's browser verifier, which is not built yet. It checks no
 * signature and no attestation, accepts every answer, and so makes `checksSignatures` false: the
 * screens say on every page that signatures are not verified. A build that talks to a live node
 * uses it only in `live-dev` mode; `live` refuses it. Delete it when the real verifier lands.
 */

import type { Verifier } from "./verifier";

export const devStubVerifier: Verifier = {
  name: "dev stub (verifies nothing)",
  checksSignatures: false,
  verifyAttestation: async () => ({ ok: false, reason: "The dev stub verifier cannot verify a hardware attestation." }),
  verifyResponse: () => ({ ok: true }),
  openFrames: () => ({ verify: () => ({ ok: true }) }),
};
