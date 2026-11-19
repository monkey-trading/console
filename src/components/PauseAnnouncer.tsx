"use client";

/** The one polite live region for a pause of trading while the trading server changes: mounted for the whole visit, so a move's remount does not drop what it says. */

import { pauseAnnouncement } from "@/lib/trading-pause-words";

import { useTradingPause } from "./ConsoleProvider";

/** Announces each step of a pause, why one failed, what holds it, or that trading resumed. */
export function PauseAnnouncer() {
  const view = useTradingPause();
  return <p aria-live="polite" className="sr-only">{pauseAnnouncement(view)}</p>;
}
