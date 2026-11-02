/** The account read's shape, `GET /v1/accounts/{address}`. */

import type { MarketId, Position, RestingOrder } from "./types";

/** Where one position's account closes out; `price` is set only for `at`, in the market's quote currency. */
export interface PositionCloseout {
  market: MarketId;
  reach: "due" | "at" | "beyond";
  price: string | null;
}

/** `GET /v1/accounts/{address}`. */
export interface AccountView {
  balance: string;
  unfinalised_deposits?: string;
  equity: string;
  margin: string;
  positions: Record<string, Position>;
  orders: Record<string, RestingOrder>;
  toxicity_bps: number;
  /** Each position's close-out; absent from a node that predates it. */
  closeouts?: PositionCloseout[];
}
