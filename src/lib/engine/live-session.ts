/** Builds the live client for a build's deployment from the browser's own `fetch`, WebSocket and clock. */

import { acceptsMockAttestation, streamOrigin, type Deploy } from "./deploy";
import { LiveEngineClient } from "./live";
import type { Scheduler, Socket } from "./live-stream";
import { loadVerifier } from "./load-verifier";
import type { VerifierModule } from "./wasm-verifier";
import { RELEASE_MANIFESTS } from "./manifests";

/** Where the build serves the verifier's pinned WebAssembly from. */
export const WASM_PATH = "/engine-verify/engine_verify_bg.wasm";
export const GLUE_PATH = "/engine-verify/engine_verify.js";

export interface Browser {
  fetch: typeof fetch;
  openSocket(url: string): Socket;
  scheduler: Scheduler;
  nowMs(): number;
  /** Imports the verifier's glue from the app's own origin. */
  loadGlue(): Promise<VerifierModule>;
}

/**
 * The client for a live deployment. Only a dev build for a listed dev origin gets a verifier that
 * can read a mock attestation.
 * Error cases:
 * - the deployment is the mock, which has no node to talk to
 */
export function createLiveClient(deploy: Deploy, browser: Browser): LiveEngineClient {
  if (deploy.origin === null || deploy.chainId === null || deploy.vault === null) throw new Error("A live client needs a deployment with a node origin, chain id and vault.");
  const allowMock = acceptsMockAttestation(deploy);
  return new LiveEngineClient({
    origin: deploy.origin, streamOrigin: streamOrigin(deploy.origin), chainId: deploy.chainId, vault: deploy.vault, heartbeatMs: deploy.heartbeatMs,
    loadVerifier: () => loadVerifier({ allowMock, loadGlue: browser.loadGlue, fetchWasm: async () => new Uint8Array(await (await browser.fetch(WASM_PATH)).arrayBuffer()) }),
    manifests: RELEASE_MANIFESTS, acceptsMock: allowMock, ...browser,
  });
}
