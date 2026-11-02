"use client";

/** The trading preferences, re-rendering only when one changes. The server and the first client render use the defaults. */

import { useSyncExternalStore } from "react";

import { DEFAULT_STATE, type PrefsState } from "@/lib/prefs-store";

import { useSession } from "./ConsoleProvider";

export function usePrefs(): PrefsState {
  const { prefs } = useSession();
  return useSyncExternalStore(prefs.subscribe, prefs.getSnapshot, () => DEFAULT_STATE);
}
