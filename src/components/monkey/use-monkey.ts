"use client";

/** Hooks the MONKEY page's panels read through: narrow slices of the console's state, so a stream patch re-renders nothing here, and the page's own store. */

import { createContext, useContext, useSyncExternalStore } from "react";

import type { MonkeyPanel, PanelState } from "@/lib/monkey/panel";
import type { ConsoleState } from "@/lib/store/state";

import { useSession } from "../ConsoleProvider";

/**
 * A value derived from the console's state. It re-renders only when the selected value changes, so
 * `select` returns a primitive or a value whose identity holds while the state it reads does.
 */
export function useConsoleSelect<T>(select: (state: ConsoleState) => T): T {
  const { store } = useSession();
  const read = () => select(store.getSnapshot());
  return useSyncExternalStore(store.subscribe, read, read);
}

const PanelContext = createContext<MonkeyPanel | null>(null);
export const MonkeyPanelProvider = PanelContext.Provider;

/** The page's store. Throws outside the page. */
export function useMonkeyPanel(): MonkeyPanel {
  const panel = useContext(PanelContext);
  if (panel === null) throw new Error("useMonkeyPanel is used outside the MONKEY page");
  return panel;
}

/** The page's reads of the node and the connected wallet. */
export function usePanelState(): PanelState {
  const panel = useMonkeyPanel();
  return useSyncExternalStore(panel.subscribe, panel.getSnapshot, panel.getSnapshot);
}
