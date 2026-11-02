"use client";

/** A confirm window tied to a component: its timer is cleared when the component unmounts, and a StrictMode remount starts clean. */

import { useEffect, useState, useSyncExternalStore } from "react";

import { ConfirmWindow, type ConfirmState } from "@/lib/confirm-window";
import type { Scheduler } from "@/lib/engine/live-stream";

const scheduler: Scheduler = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  // The handle is the one this scheduler's own setTimeout returned.
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A press repeated within `lapseMs` confirms, but not within `minGapMs` of the first (a double-click's second click). `armed` is for rendering; `state` is read at a press. */
export function useConfirmWindow(lapseMs: number, minGapMs: number): { armed: boolean; state: () => ConfirmState; arm: () => void; cancel: () => void } {
  const [confirmWindow] = useState(() => new ConfirmWindow(scheduler, lapseMs, minGapMs, () => Date.now()));
  const armed = useSyncExternalStore(confirmWindow.subscribe, confirmWindow.isArmed, () => false);
  useEffect(() => confirmWindow.cancel, [confirmWindow]);
  return { armed, state: confirmWindow.state, arm: confirmWindow.arm, cancel: confirmWindow.cancel };
}
