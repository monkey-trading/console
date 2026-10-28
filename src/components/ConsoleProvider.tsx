"use client";

/** Creates the mock node and the store once, follows the node's clock, and shares both. */

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { DEMO_ADDRESS } from "@/lib/mock/demo";
import { mockHistory } from "@/lib/mock/history";
import { createMockNode, SIM_EPOCH_MS, type MockNode } from "@/lib/mock";
import { connectWallet } from "@/lib/store/actions";
import { ConsoleStore } from "@/lib/store/store";
import type { ConsoleState } from "@/lib/store/state";

interface Session {
  store: ConsoleStore;
  node: MockNode;
}

const SessionContext = createContext<Session | null>(null);

/** How often the page advances the mock node, in milliseconds. */
const TICK_MS = 1_000;

function createSession(): Session {
  const node = createMockNode(SIM_EPOCH_MS, true);
  const store = new ConsoleStore({
    client: node.client,
    wallets: node.wallets,
    drive: (ms) => node.client.tick(ms),
    history: mockHistory,
    initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS, recent: node.client.recentLog(1000), viewer: DEMO_ADDRESS },
  });
  return { store, node };
}

/** The most simulated time one tick may add, so a stalled timer does not jump the prices. */
const MAX_TICK_MS = 5_000;

/**
 * Provides the console's session to every screen. The node's clock starts at the demo's fixed
 * instant and advances with real time, but only while the simulation runs: it stands still when
 * the user pauses it, when the tab is hidden, and from the start for a visitor who prefers reduced
 * motion, until they press play.
 */
export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [session] = useState(createSession);
  const { store } = session;
  useEffect(() => {
    const stop = store.start(SIM_EPOCH_MS);
    // The demo account is connected on load, so no screen starts empty.
    void connectWallet(store, "browser", true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) store.setPaused(true);
    let simulated = SIM_EPOCH_MS;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.min(now - last, MAX_TICK_MS);
      last = now;
      if (store.getSnapshot().paused || document.visibilityState === "hidden") return;
      simulated += elapsed;
      store.tick(simulated);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [store]);
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
