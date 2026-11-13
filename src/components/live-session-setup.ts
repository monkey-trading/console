/**
 * The session for a live node, built apart from the page (monkey-trading/console#338): the connectors, the
 * verifier's loader and the operator follower carry the viem code a mock build never runs, so the provider
 * loads this once it knows the build pins a node. The session key signer loads first, so the synchronous
 * readers of a stored key stay synchronous.
 */

import { MultiConnector } from "@/lib/engine/connectors";
import type { Deploy } from "@/lib/engine/deploy";
import { InjectedConnector } from "@/lib/engine/injected";
import { createLiveClient, GLUE_PATH, walletDeps } from "@/lib/engine/live-session";
import { OperatorFollower } from "@/lib/engine/operator-follow";
import type { EngineClient } from "@/lib/engine/client";
import type { KeyStorage } from "@/lib/engine/session-key-store";
import { loadSessionKeySigner } from "@/lib/engine/session-key-class";
import { WalletConnectConnector } from "@/lib/engine/walletconnect";
import type { VerifierModule } from "@/lib/engine/wasm-verifier";
import { WatchConnector } from "@/lib/engine/watch-wallet";
import { walletSessionEnded } from "@/lib/store/actions";
import { moveToNode, MoveAnnouncer } from "@/lib/store/node-move";
import { scanBarsHistory } from "@/lib/store/bars-scan";
import { ConsoleStore } from "@/lib/store/store";

import { createPrefs, exitStorage, injectedProvider, scheduler, type Session } from "./session-env";

/** The store for a live node: nothing is loaded until its attestation is trusted. */
export async function createLiveSession(deploy: Deploy): Promise<Session> {
  await loadSessionKeySigner();
  const nowMs = () => Date.now();
  const browser = {
    fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init),
    openSocket: (url: string) => new WebSocket(url),
    scheduler, nowMs,
    // The glue is a static file of the app, loaded as it is rather than bundled; the bundler would otherwise look for the .wasm beside it.
    loadGlue: () => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ GLUE_PATH) as Promise<VerifierModule>,
  };
  const client = createLiveClient(deploy, browser);
  if (deploy.origin === null || deploy.chainId === null || deploy.vault === null) throw new Error("A live session needs the deployment's node, chain id and vault.");
  const chain = { chainId: deploy.chainId, vault: deploy.vault, usdc: deploy.usdc, staking: deploy.staking, registry: deploy.registry, add: deploy.rpcUrl === null ? null : { name: deploy.chainId === 31337 ? "Anvil (local)" : `Chain ${deploy.chainId}`, rpcUrl: deploy.rpcUrl } };
  const deps = walletDeps(deploy, (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // The choice and the session key persist in localStorage, reached lazily, only from effects and handlers.
  const persistence: KeyStorage = {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
    keys: () => Object.keys(window.localStorage),
  };
  // When the wallet app ends the session, the console shows the wallet disconnected rather than
  // failing every action, and forgets the choice: the remembered connection has ended. (The dead
  // session cannot sign a revocation: walletSessionEnded leaves the key's registration to expire.)
  const ended = (topic: string) => walletSessionEnded(store, topic);
  const walletConnect = deploy.walletConnectProjectId === null ? null : new WalletConnectConnector(
    { projectId: deploy.walletConnectProjectId, url: () => window.location.origin }, chain, deps, () => import("@walletconnect/universal-provider"), ended,
  );
  const wallets = new MultiConnector([new InjectedConnector(injectedProvider, chain, deps), ...(walletConnect === null ? [] : [walletConnect]), new WatchConnector(() => window.location.search)]);
  // A node without the marks endpoint 404s it; the chart's archive scan then seeds its history.
  const storeFor = (forClient: EngineClient) => new ConsoleStore({ client: forClient, wallets, persistence, exitStorage, history: () => [], historyScan: (store, markets) => scanBarsHistory(store, markets, store.deps.scanClock), initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  // The store in use, which a move to another node replaces; `ended` above and the follower below read it when they run.
  let store = storeFor(client);
  let moved: ((next: ConsoleStore) => void) | null = null;
  const follower = new OperatorFollower({
    deploy, origin: deploy.origin, scheduler, nowMs,
    chain: () => store.liveWallet?.chainReads ?? null,
    open: (origin) => createLiveClient(deploy, browser, undefined, origin),
    busy: () => store.getSnapshot().busy,
    adopt: (next) => {
      const old = store;
      store = storeFor(next);
      void moveToNode(old, store);
      moved?.(store);
    },
  });
  return { store, deploy, node: null, walletConnect, prefs: createPrefs(), follower, moves: 0, announcer: new MoveAnnouncer(), onMove: (listener) => { moved = listener; } };
}

