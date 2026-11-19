/** Which positions a Close all sends, and which it leaves out and why. */

import type { MarketId } from "./engine/types";
import type { ConfirmState } from "./confirm-window";
import type { Fixed } from "./fixed";

/** The slippage bound a Close, Close all and Close hedge send, capped at the market's own. */
export const CLOSE_SLIPPAGE_BPS = 25;

/** One open position as its row shows it: `quoted` is the price its own Close button would send, null when it has none. */
export interface CloseRow {
  market: MarketId;
  symbol: string;
  /** Whether the market is open to trade now. */
  open: boolean;
  quoted: Fixed | null;
  /** Whether the node quotes no price for this market until it is selected (it quotes at most four at once). */
  select?: boolean;
}

/** A position to close and the price its own Close button quotes. */
export interface CloseTarget {
  market: MarketId;
  quoted: Fixed;
}

/** A position Close all leaves out: its market is closed, no closing price has reached the console for it, or none comes until the market is selected. */
export interface LeftOut {
  symbol: string;
  why: "market closed" | "closing price not yet available" | "select it in the watchlist to load its closing price";
}

/** The positions to send, in the order the rows list them, and those left out, which the page names. */
export function planCloseAll(rows: readonly CloseRow[]): { targets: CloseTarget[]; leftOut: LeftOut[] } {
  const targets: CloseTarget[] = [];
  const leftOut: LeftOut[] = [];
  for (const row of rows) {
    if (!row.open) leftOut.push({ symbol: row.symbol, why: "market closed" });
    else if (row.quoted === null) leftOut.push({ symbol: row.symbol, why: row.select === true ? "select it in the watchlist to load its closing price" : "closing price not yet available" });
    else targets.push({ market: row.market, quoted: row.quoted });
  }
  return { targets, leftOut };
}

/** One position of a hedge as its row shows it: `quoted` is its own Close button's price, null when it has none, and `mark` its market's latest mark. */
export interface HedgeMember {
  market: MarketId;
  symbol: string;
  open: boolean;
  quoted: Fixed | null;
  mark: Fixed | null;
}

/**
 * What Close hedge sends (monkey-trading/engine#913, D7): one close-all entry for each position of the hedge whose market can
 * trade, in row order, priced at its own Close button's quote where the console has one and otherwise at its mark, since the
 * node quotes at most four markets at once; the symbols of those whose market is closed or has no price, which it leaves out.
 */
export function planGroupClose(members: readonly HedgeMember[]): { targets: CloseTarget[]; untradable: string[] } {
  const targets: CloseTarget[] = [];
  const untradable: string[] = [];
  for (const member of members) {
    const reference = member.quoted ?? member.mark;
    if (member.open && member.mark !== null && reference !== null) targets.push({ market: member.market, quoted: reference });
    else untradable.push(member.symbol);
  }
  return { targets, untradable };
}

/** The sentence under the button that names what a Close all leaves out, or null when it leaves nothing. */
export function describeLeftOut(leftOut: readonly LeftOut[]): string | null {
  if (leftOut.length === 0) return null;
  return `${leftOut.length === 1 ? "The following position is" : "The following positions are"} not included in Close all: ${leftOut.map((l) => `${l.symbol} (${l.why})`).join(", ")}.`;
}

/** The markets Close all would send, in order: the window it opened closes when this changes, so a press confirms the list it was armed for. */
export const targetsKey = (targets: readonly CloseTarget[]): string => targets.map((t) => t.market).join(",");

/** What a press of Close all does: the first arms the confirm window, a press that follows it by a moment does nothing, a press after that sends, and with nothing to close it does nothing. */
export function pressCloseAll(state: ConfirmState, count: number): "arm" | "send" | "none" {
  if (count === 0 || state === "early") return "none";
  return state === "ready" ? "send" : "arm";
}

/** `pressCloseAll` for a batch whose confirmation is a preference: with it off, a press with something to send sends at once. */
export function pressBatch(confirm: boolean, state: ConfirmState, count: number): "arm" | "send" | "none" {
  if (!confirm) return count === 0 ? "none" : "send";
  return pressCloseAll(state, count);
}
