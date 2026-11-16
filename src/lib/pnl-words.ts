/** The words behind a position's P&L: its basis, the figure at the mark it replaces, and why a figure is withheld. */

/**
 * The explanation of one position's P&L. A close at the closing price has `atMark`, the gain at the
 * mark, which the exit spread takes from; a position with no closing price has `reason` instead, and
 * `atMark` as the only figure there is.
 */
export function describePnl(atMark: string | null, reason: string | null): string {
  if (reason !== null) return atMark === null ? reason : `${reason} At the mark price it's ${atMark}.`;
  return atMark === null ? "This uses the price you'd close the whole position at." : `This uses the price you'd close the whole position at. At the mark price it's ${atMark}, before the spread.`;
}

/** What stands between a position and a closing price, in the order a close needs them. */
export interface CloseGaps {
  symbol: string;
  /** Whether the market is open to trade now. */
  open: boolean;
  /** Whether the market has a mark, and, for one quoted in another currency, the FX price that converts it. */
  marked: boolean;
  converts: boolean;
  /** Whether a closing price for the position's size has reached the console, and whether the console asked the node for it. */
  quoted: boolean;
  asked: boolean;
  /** Whether the house state's terms are current, and its reason when they are not, if it has one; whether the profit fee's rate is read. */
  termsCurrent: boolean;
  houseNote: string | null;
  rateRead: boolean;
}

/** Why a position has no closing price, or null when it has one. */
export function describeNoPrice(g: CloseGaps): string | null {
  if (!g.open) return "The market is closed, so there's no closing price.";
  if (!g.marked) return "This market has no price yet.";
  if (!g.converts) return "The exchange rate for this market isn't available yet, so it can't be shown in USD.";
  if (g.quoted) return null;
  return g.asked ? "Waiting for a closing price." : `Select ${g.symbol} to see its closing price.`;
}

/** Why the profit fee and what a close keeps are withheld, or null when they are shown: no closing price, else the house state's reason, else the unread rate. */
export function describeNoClose(g: CloseGaps): string | null {
  const price = describeNoPrice(g);
  if (price !== null) return price;
  if (!g.termsCurrent) return g.houseNote ?? "The trading terms haven't loaded yet.";
  return g.rateRead ? null : "The profit fee rate hasn't loaded yet.";
}

/** A row's details in one explanation: the P&L's basis, and what the fee and the close keep come to. */
export function describeDetails(parts: { pnl: string; noClose: string | null; noFee: boolean }): string {
  const close = parts.noClose !== null ? `The fee and close figures aren't shown yet. ${parts.noClose}` : parts.noFee ? "There's no profit fee, because closing now doesn't make a profit." : null;
  return [parts.pnl, close].filter((x) => x !== null).join(" ");
}
