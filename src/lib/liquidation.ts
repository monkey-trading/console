/** Where a position would be closed out, estimated from the account's current margin. */

import { bpsOf, divFixed, mulFixed, type Fixed } from "./fixed";
import type { AccountModel, MarketModel } from "./models";
import { CLOSE_OUT_BPS } from "./pricing";

/**
 * The index at which `account` would be closed out if it held every other mark and its margin
 * stayed where it is: the price where equity falls to the close-out share of margin. An estimate,
 * since margin changes with the price; null when there is no such price above zero.
 */
export function liquidationPrice(account: AccountModel, market: MarketModel, others: readonly MarketModel[]): Fixed | null {
  const position = account.positions.find((p) => p.market === market.id);
  if (!position || position.qty === 0n) return null;
  let otherPnl = 0n;
  for (const p of account.positions) {
    const m = others.find((o) => o.id === p.market);
    if (p.market !== market.id && m?.mark != null) otherPnl += mulFixed(p.qty, m.mark - p.entry);
  }
  const threshold = bpsOf(account.margin, CLOSE_OUT_BPS);
  const price = position.entry + divFixed(threshold - account.balance - otherPnl, position.qty);
  return price > 0n ? price : null;
}
