/** Which positions a Close all sends, and which it leaves out and why. */

import type { MarketId } from "./engine/types";
import type { ConfirmState } from "./confirm-window";
import type { Fixed } from "./fixed";

/** One open position as its row shows it: `quoted` is the price its own Close button would send, null when it has none. */
export interface CloseRow {
  market: MarketId;
  symbol: string;
  /** Whether the market is open to trade now. */
  open: boolean;
  quoted: Fixed | null;
}

/** A position to close and the price its own Close button quotes. */
export interface CloseTarget {
  market: MarketId;
  quoted: Fixed;
}

/** A position Close all leaves out: its market is closed, or no closing price has reached the console for it. */
export interface LeftOut {
  symbol: string;
  why: "market closed" | "no closing price yet";
}

/** The positions to send, in the order the rows list them, and those left out, which the page names. */
export function planCloseAll(rows: readonly CloseRow[]): { targets: CloseTarget[]; leftOut: LeftOut[] } {
  const targets: CloseTarget[] = [];
  const leftOut: LeftOut[] = [];
  for (const row of rows) {
    if (!row.open) leftOut.push({ symbol: row.symbol, why: "market closed" });
    else if (row.quoted === null) leftOut.push({ symbol: row.symbol, why: "no closing price yet" });
    else targets.push({ market: row.market, quoted: row.quoted });
  }
  return { targets, leftOut };
}

/** The sentence under the button that names what a Close all leaves out, or null when it leaves nothing. */
export function describeLeftOut(leftOut: readonly LeftOut[]): string | null {
  if (leftOut.length === 0) return null;
  return `Close all leaves out ${leftOut.map((l) => `${l.symbol} (${l.why})`).join(", ")}.`;
}

/** The markets Close all would send, in order: the window it opened closes when this changes, so a press confirms the list it was armed for. */
export const targetsKey = (targets: readonly CloseTarget[]): string => targets.map((t) => t.market).join(",");

/** What a press of Close all does: the first arms the confirm window, a press that follows it by a moment does nothing, a press after that sends, and with nothing to close it does nothing. */
export function pressCloseAll(state: ConfirmState, count: number): "arm" | "send" | "none" {
  if (count === 0 || state === "early") return "none";
  return state === "ready" ? "send" : "arm";
}
