"use client";

/** Creates the store once, over the in-browser mock node or a live node by the build's deployment, follows the node's clock, and shares them. */

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { MultiConnector } from "@/lib/engine/connectors";
import { parseDeploy, rawDeploy, type Deploy } from "@/lib/engine/deploy";
import { InjectedConnector } from "@/lib/engine/injected";
import { createLiveClient, GLUE_PATH } from "@/lib/engine/live-session";
import type { Eip1193Provider } from "@/lib/engine/provider-wallet";
import { WalletConnectConnector } from "@/lib/engine/walletconnect";
import { clearChoice, type ChoiceStorage } from "@/lib/engine/wallet-persist";
import type { VerifierModule } from "@/lib/engine/wasm-verifier";
import { WatchConnector } from "@/lib/engine/watch-wallet";
import { DEMO_ADDRESS } from "@/lib/mock/demo";
import { queuePage } from "@/lib/mock/funds";
import { mockHistory } from "@/lib/mock/history";
import { createMockNode, SIM_EPOCH_MS, type MockNode } from "@/lib/mock";
import { connectWallet, disconnectWallet } from "@/lib/store/actions";
import { reconnectWallet } from "@/lib/store/reconnect";
import { scanBarsHistory } from "@/lib/store/bars-scan";
import { followAccountFeeds, quoteSyncKey, syncQuotes } from "@/lib/store/funds";
import { ConsoleStore } from "@/lib/store/store";
import type { ConsoleState } from "@/lib/store/state";

interface Session {
  store: ConsoleStore;
  /** The deployment this build pins; what the faucet gates on, among the rest. */
  deploy: Deploy;
  /** The in-browser node; null when the console talks to a live one. */
  node: MockNode | null;
  /** The WalletConnect connector, whose pairing link the pairing dialog shows; null when the build has none. */
  walletConnect: WalletConnectConnector | null;
}

const SessionContext = createContext<Session | null>(null);

/** How often the page advances the mock node, in milliseconds. */
const TICK_MS = 1_000;

/** The page's injected EIP-1193 provider, when a browser wallet put one there. */
function injectedProvider(): Eip1193Provider | undefined {
  // EIP-1193 providers sit at `window.ethereum`, which the DOM types do not declare.
  return (window as Window & { ethereum?: Eip1193Provider }).ethereum;
}

/** The store for a live node: nothing is loaded until its attestation is trusted. */
function createLiveSession(deploy: Deploy): Session {
  const client = createLiveClient(deploy, {
    fetch: (input, init) => fetch(input, init),
    openSocket: (url) => new WebSocket(url),
    scheduler: { setTimeout: (run, ms) => setTimeout(run, ms), // The handle is the one this scheduler's own setTimeout returned.
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    nowMs: () => Date.now(),
    // The glue is a static file of the app, loaded as it is rather than bundled; the bundler would otherwise look for the .wasm beside it.
    loadGlue: () => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ GLUE_PATH) as Promise<VerifierModule>,
  });
  if (deploy.chainId === null || deploy.vault === null) throw new Error("A live session needs the deployment's chain id and vault.");
  const chain = { chainId: deploy.chainId, vault: deploy.vault, usdc: deploy.usdc, add: deploy.rpcUrl === null ? null : { name: deploy.chainId === 31337 ? "Anvil (local)" : `Chain ${deploy.chainId}`, rpcUrl: deploy.rpcUrl } };
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  // The choice persists in localStorage, reached lazily: this function also runs on the server,
  // where `window` does not exist, so the storage is touched only from effects and handlers.
  const persistence: ChoiceStorage = {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  };
  // When the wallet app ends the session, the console shows the wallet disconnected rather than
  // failing every action, and forgets the choice: the remembered connection has ended.
  const ended = () => {
    if (store.liveWallet?.label !== "WalletConnect") return;
    clearChoice(persistence);
    disconnectWallet(store);
    store.toast("info", "Your wallet ended the WalletConnect session, so the console disconnected it.");
  };
  const walletConnect = deploy.walletConnectProjectId === null ? null : new WalletConnectConnector(
    { projectId: deploy.walletConnectProjectId, url: () => window.location.origin }, chain, { wait }, () => import("@walletconnect/universal-provider"), ended,
  );
  const wallets = new MultiConnector([new InjectedConnector(injectedProvider, chain, { wait }), ...(walletConnect === null ? [] : [walletConnect]), new WatchConnector(() => window.location.search)]);
  // A node without the marks endpoint 404s it; the chart's archive scan then seeds its history.
  const store = new ConsoleStore({ client, wallets, persistence, history: () => [], historyScan: (store, markets) => scanBarsHistory(store, markets, store.deps.scanClock), initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  return { store, deploy, node: null, walletConnect };
}

function createSession(): Session {
  const deploy = parseDeploy(rawDeploy());
  if (deploy.mode !== "mock") return createLiveSession(deploy);
  const node = createMockNode(SIM_EPOCH_MS, true);
  const store = new ConsoleStore({
    client: node.client,
    wallets: node.wallets,
    drive: (ms) => node.client.tick(ms),
    history: mockHistory,
    initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS, recent: node.client.recentLog(1000), viewer: DEMO_ADDRESS, housePanel: node.client.housePanelSnapshot(),
      session: {
        wallet: { address: DEMO_ADDRESS, label: "Browser wallet" },
        account: node.client.accountView(DEMO_ADDRESS),
        eligibility: node.client.eligibilityClass(DEMO_ADDRESS),
        queue: queuePage(node.client.state, DEMO_ADDRESS).queue,
        history: node.client.historyPage(DEMO_ADDRESS, { limit: 100 }).events,
      },
    },
  });
  return { store, deploy, node, walletConnect: null };
}

/** The most simulated time one tick may add, so a stalled timer does not jump the prices. */
const MAX_TICK_MS = 5_000;

/**
 * Provides the console's session to every screen. A live node sets its own clock with its
 * messages. The mock's clock starts at the demo's fixed instant and advances with real time, but
 * only while the simulation runs: it stands still when the user pauses it, when the tab is hidden,
 * and from the start for a visitor who prefers reduced motion, until they press play.
 */
export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [session] = useState(createSession);
  const { store } = session;
  /** Set once a stored choice has been reconnected, so a repeated effect run (React StrictMode) does not start a second one. */
  const reconnected = useRef(false);
  useEffect(() => {
    if (session.node === null) {
      // A live node sets the clock with its first message; the page follows it, and the account the address names.
      const stopLive = store.start(0);
      const stopFeeds = followAccountFeeds(store);
      // An address in the URL names the account to watch; it wins over a stored connection
      // choice, which would otherwise replace the read-only view when its wallet answers.
      if (new URLSearchParams(window.location.search).has("account")) void connectWallet(store, "watch", true);
      else if (!reconnected.current) {
        reconnected.current = true;
        void reconnectWallet(store, session.walletConnect, () => injectedProvider() !== undefined);
      }
      return () => {
        stopFeeds();
        stopLive();
      };
    }
    const stop = store.start(SIM_EPOCH_MS);
    // The demo account is connected on load, so no screen starts empty.
    void connectWallet(store, "browser", true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) store.setPaused(true);
    let simulated = SIM_EPOCH_MS;
    let last = Date.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    const running = () => !store.getSnapshot().paused && document.visibilityState !== "hidden";
    const step = () => {
      const now = Date.now();
      simulated += Math.min(now - last, MAX_TICK_MS);
      last = now;
      store.tick(simulated);
    };
    // The timer exists only while the simulation runs, so nothing ticks when paused or hidden.
    const sync = () => {
      if (running() && timer === null) {
        last = Date.now();
        timer = setInterval(step, TICK_MS);
      } else if (!running() && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    const unsubscribe = store.subscribe(sync);
    return () => {
      if (timer !== null) clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      unsubscribe();
      stop();
    };
  }, [store, session]);
  useEffect(() => {
    if (session.node !== null) return;
    // The node's quote subscription follows the account, the selected market and the markets held; a
    // request the node refused (an account not yet credited) is sent again once the account is credited.
    let key = "";
    const sync = () => {
      const next = quoteSyncKey(store.getSnapshot());
      if (next === key) return;
      key = next;
      syncQuotes(store);
    };
    sync();
    const unsubscribe = store.subscribe(sync);
    return () => {
      unsubscribe();
      store.deps.client.quotes(null);
    };
  }, [store, session.node]);
  return <SessionContext value={session}>{children}</SessionContext>;
}

/** The session. Throws outside the provider. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession is used outside ConsoleProvider");
  return session;
}

/** The console's state, re-rendering on every change. */
export function useConsole(): ConsoleState {
  const { store } = useSession();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
