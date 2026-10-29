/** Builds the live client for a build's deployment from the browser's own `fetch`, WebSocket and clock. */

import { acceptsMockAttestation, streamOrigin, type Deploy } from "./deploy";
import { devStubVerifier } from "./dev-stub-verifier";
import { LiveEngineClient } from "./live";
import type { Scheduler, Socket } from "./live-stream";
import { RELEASE_MANIFESTS } from "./manifests";
import { unavailableVerifier, type Verifier } from "./verifier";

export interface Browser {
  fetch: typeof fetch;
  openSocket(url: string): Socket;
  scheduler: Scheduler;
  nowMs(): number;
}

/** The dev stub only in a dev build; a production build has no verifier until the engine's is built in. */
export function verifierFor(deploy: Deploy): Verifier {
  return deploy.mode === "live-dev" ? devStubVerifier : unavailableVerifier;
}

/**
 * The client for a live deployment.
 * Error cases:
 * - the deployment is the mock, which has no node to talk to
 */
export function createLiveClient(deploy: Deploy, browser: Browser): LiveEngineClient {
  if (deploy.origin === null || deploy.chainId === null || deploy.vault === null) throw new Error("A live client needs a deployment with a node origin, chain id and vault.");
  return new LiveEngineClient({
    origin: deploy.origin, streamOrigin: streamOrigin(deploy.origin), chainId: deploy.chainId, vault: deploy.vault, heartbeatMs: deploy.heartbeatMs,
    verifier: verifierFor(deploy), manifests: RELEASE_MANIFESTS, acceptsMock: acceptsMockAttestation(deploy), ...browser,
  });
}
