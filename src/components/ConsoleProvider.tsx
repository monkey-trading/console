"use client";

/** Creates the mock node and the store once, follows the node's clock, and shares both. */

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { mockHistory } from "@/lib/mock/history";
import { createMockNode, SIM_EPOCH_MS, type MockNode } from "@/lib/mock";
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
  const node = createMockNode(SIM_EPOCH_MS);
  const store = new ConsoleStore({
    client: node.client,
    wallets: node.wallets,
    drive: (ms) => node.client.tick(ms),
    history: mockHistory,
    initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS },
  });
  return { store, node };
}

/** Provides the console's session to every screen. */
export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [session] = useState(createSession);
  const { store } = session;
  useEffect(() => {
    const stop = store.start(Date.now());
    const timer = setInterval(() => store.tick(Date.now()), TICK_MS);
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
