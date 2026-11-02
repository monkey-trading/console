/** The close-out marker the chart draws. */

import type { AccountModel, MarketModel } from "./models";
import type { Fixed } from "./fixed";

/**
 * The close-out marker the chart draws, or null: the price the node gave for the position, the one
 * the Positions table shows. Due, None and an unknown close-out have no price to draw.
 */
export function closeOutMarker(account: AccountModel, market: MarketModel): Fixed | null {
  const closeout = account.positions.find((p) => p.market === market.id)?.closeout ?? null;
  return closeout?.reach === "at" ? closeout.price : null;
}
