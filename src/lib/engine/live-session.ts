/** Builds the live client for a build's deployment from the browser's own `fetch`, WebSocket and clock, and what the build gives its wallets. */

import { acceptsMockAttestation, listedOrigins, streamOrigin, type Deploy } from "./deploy";
import { postJsonRpc } from "./faucet";
import { LiveEngineClient } from "./live";
import type { Scheduler, Socket } from "./live-stream";
import { loadVerifier } from "./load-verifier";
import type { VerifierModule } from "./wasm-verifier";
import { PINNED_RELEASES } from "./manifests";
import type { ProviderWalletDeps } from "./provider-wallet";
import { staleNonce } from "./stale-nonce";

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
 * The client for the node at `origin`, the build's own by default. Only a dev build for a listed dev
 * origin gets a verifier that can read a mock attestation. A client answers for one node for its
 * whole life: another node is another client, so nothing read from one reaches the other.
 * Error cases:
 * - the deployment is the mock, which has no node to talk to
 * - `origin` is not one the build lists, which its CSP would refuse anyway
 */
export function createLiveClient(deploy: Deploy, browser: Browser, load: typeof loadVerifier = loadVerifier, origin: string | null = deploy.origin): LiveEngineClient {
  if (origin === null || deploy.chainId === null || deploy.vault === null) throw new Error("A live client needs a deployment with a node origin, chain id and vault.");
  if (!listedOrigins(deploy).includes(origin)) throw new Error(`This build does not list the node origin ${origin}.`);
  const allowMock = acceptsMockAttestation(deploy, origin);
  return new LiveEngineClient({
    origin, streamOrigin: streamOrigin(origin), chainId: deploy.chainId, vault: deploy.vault, heartbeatMs: deploy.heartbeatMs,
    loadVerifier: () => load({ allowMock, loadGlue: browser.loadGlue, fetchWasm: async () => new Uint8Array(await (await browser.fetch(WASM_PATH)).arrayBuffer()) }),
    releases: PINNED_RELEASES, devDigests: deploy.devLaunchDigests, acceptsMock: allowMock, ...browser,
  });
}

/**
 * What every wallet the build connects is given: `wait` for its receipt polls and, in a `live-dev`
 * build with a pinned RPC, the check for a transaction stuck behind a nonce from an earlier chain.
 */
export function walletDeps(deploy: Deploy, wait: (ms: number) => Promise<void>): ProviderWalletDeps {
  const { rpcUrl } = deploy;
  if (deploy.mode !== "live-dev" || rpcUrl === null) return { wait };
  return { wait, stuck: (hash, account) => staleNonce(rpcUrl, postJsonRpc, hash, account) };
}
