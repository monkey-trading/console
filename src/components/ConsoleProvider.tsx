"use client";

/** Creates the store once, over the in-browser mock node or a live node by the build's deployment, follows the node's clock, and shares them. */

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { parseDeploy, rawDeploy } from "@/lib/engine/deploy";
import { createLiveClient, GLUE_PATH } from "@/lib/engine/live-session";
import type { VerifierModule } from "@/lib/engine/wasm-verifier";
import { WatchConnector } from "@/lib/engine/watch-wallet";
import { DEMO_ADDRESS } from "@/lib/mock/demo";
import { queuePage } from "@/lib/mock/funds";
import { mockHistory } from "@/lib/mock/history";
import { createMockNode, SIM_EPOCH_MS, type MockNode } from "@/lib/mock";
import { connectWallet } from "@/lib/store/actions";
import { ConsoleStore } from "@/lib/store/store";
import type { ConsoleState } from "@/lib/store/state";

interface Session {
  store: ConsoleStore;
  /** The in-browser node; null when the console talks to a live one. */
  node: MockNode | null;
}

const SessionContext = createContext<Session | null>(null);

/** How often the page advances the mock node, in milliseconds. */
const TICK_MS = 1_000;

/** The store for a live node: nothing is loaded until its attestation is trusted, and the account is read-only. */
function createLiveSession(): Session {
  const deploy = parseDeploy(rawDeploy());
  const client = createLiveClient(deploy, {
    fetch: (input, init) => fetch(input, init),
    openSocket: (url) => new WebSocket(url),
    scheduler: { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    nowMs: () => Date.now(),
    // The glue is a static file of the app, loaded as it is rather than bundled; the bundler would otherwise look for the .wasm beside it.
    loadGlue: () => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ GLUE_PATH) as Promise<VerifierModule>,
  });
  const wallets = new WatchConnector(() => window.location.search);
  const store = new ConsoleStore({ client, wallets, history: () => [], initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  return { store, node: null };
}

function createSession(): Session {
  if (parseDeploy(rawDeploy()).mode !== "mock") return createLiveSession();
  const node = createMockNode(SIM_EPOCH_MS, true);
  const store = new ConsoleStore({
    client: node.client,
    wallets: node.wallets,
    drive: (ms) => node.client.tick(ms),
    history: mockHistory,
    initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS, recent: node.client.recentLog(1000), viewer: DEMO_ADDRESS,
      session: {
        wallet: { address: DEMO_ADDRESS, label: "Browser wallet" },
        account: node.client.accountView(DEMO_ADDRESS),
        eligibility: node.client.eligibilityClass(DEMO_ADDRESS),
        queue: queuePage(node.client.state, DEMO_ADDRESS).queue,
        history: node.client.historyPage(DEMO_ADDRESS, { limit: 100 }).events,
      },
    },
  });
  return { store, node };
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
  useEffect(() => {
    if (session.node === null) {
      // A live node sets the clock with its first message; the page follows it, and the account the address names.
      const stopLive = store.start(0);
      if (new URLSearchParams(window.location.search).has("account")) void connectWallet(store, "watch", true);
      return stopLive;
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
