/** The words behind a position's P&L: its basis, and the figure at the mark it replaces. */

/**
 * The explanation of one position's P&L. A close at the closing price has `atMark`, the gain at the
 * mark, which the exit spread takes from; a position with no closing price has `reason` instead, and
 * `atMark` as the only figure there is.
 */
export function describePnl(atMark: string | null, reason: string | null): string {
  if (reason !== null) return atMark === null ? reason : `${reason} At the mark it is ${atMark}.`;
  return atMark === null ? "At the node's closing price for this size." : `At the node's closing price for this size. At the mark it is ${atMark}, before the exit spread.`;
}
