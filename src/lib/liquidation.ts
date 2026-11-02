/** The close-out marker the chart draws. */

import type { SignatureChecks } from "./engine/client";
import type { AccountModel, MarketModel } from "./models";
import type { Fixed } from "./fixed";

/**
 * The close-out marker the chart draws, or null: shown only where the console models the node
 * (`signatures` is `none`, the in-browser mock), at the mock's own close-out price for the
 * position, the one the Positions table shows. A live node's own margin and spreads decide its
 * close-out, so none is drawn for it.
 */
export function closeOutMarker(signatures: SignatureChecks, account: AccountModel, market: MarketModel): Fixed | null {
  if (signatures !== "none") return null;
  const closeout = account.positions.find((p) => p.market === market.id)?.closeout ?? null;
  return closeout?.reach === "at" ? closeout.price : null;
}
