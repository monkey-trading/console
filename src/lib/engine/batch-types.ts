/** The V44 batch requests as the node's `POST /v1/orders/cancel-all` and `POST /v1/positions/close-all` take them. */

import type { Address, MarketId, RequestAuth } from "./types";

/** `POST /v1/orders/cancel-all`: cancels every resting order of the account on one signature (from V44). */
export interface CancelAllRequest {
  account: Address;
  auth?: RequestAuth;
}

/** One market a close-all closes, with the price the client saw for it (a wire decimal). */
export interface CloseEntry {
  market: MarketId;
  quoted: string;
}

/**
 * `POST /v1/positions/close-all` (from V44): closes the whole position in each listed market, in
 * list order, on one signature. `max_slippage_bps` bounds every entry; the market's own bound caps it.
 */
export interface CloseAllRequest {
  account: Address;
  closes: CloseEntry[];
  max_slippage_bps?: number;
  auth?: RequestAuth;
}
