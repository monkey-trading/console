/** The words behind a position's P&L: the figure at the mark it replaces, and why a figure is withheld. */

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
  if (!g.open) return "The market is closed, so no closing price is available.";
  if (!g.marked) return "No price is available for this market yet.";
  if (!g.converts) return "The exchange rate for this market's quote currency is not yet available, so the profit or loss cannot be shown in USD.";
  if (g.quoted) return null;
  return g.asked ? "The closing price for this position is still loading." : `Select ${g.symbol} in the watchlist to load its closing price.`;
}

/** Why the profit fee and what a close keeps are withheld, or null when they are shown: no closing price, else the house state's reason, else the unread rate. */
export function describeNoClose(g: CloseGaps): string | null {
  const price = describeNoPrice(g);
  if (price !== null) return price;
  if (!g.termsCurrent) return g.houseNote ?? "The trading terms have not loaded yet.";
  return g.rateRead ? null : "The profit fee rate has not loaded yet.";
}

/**
 * A row's details in one explanation, in at most two sentences: why a figure is withheld, or that no profit fee applies,
 * then the profit or loss at the mark, which the closing price's spread takes from. A position with no price has `noPrice`.
 */
export function describeDetails(parts: { atMark: string | null; noPrice: string | null; noClose: string | null; noFee: boolean }): string {
  const status = parts.noPrice ?? (parts.noClose !== null ? "The profit fee and closing figures are not yet available." : parts.noFee ? "No profit fee applies, because closing the position now would not realise a profit." : null);
  const mark = parts.atMark === null ? null : `At the mark price${parts.noPrice === null ? ", before the spread," : ","} the unrealised profit or loss is ${parts.atMark}.`;
  return [status, mark].filter((x) => x !== null).join(" ");
}
