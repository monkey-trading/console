/** The account read's shape, `GET /v1/accounts/{address}`. */

import type { CloseFee } from "./pricing-types";
import type { MarketId, Position, RestingOrder } from "./types";
import type { MarginStandingWire, ToxicityStandingWire, VolumeStandingWire } from "./volume-types";

/** Where one position's account closes out; `price` is set only for `at`, in the market's quote currency. */
export interface PositionCloseout {
  market: MarketId;
  reach: "due" | "at" | "beyond";
  price: string | null;
}

/** `GET /v1/accounts/{address}`. */
export interface AccountView extends MarginStandingWire {
  balance: string;
  unfinalised_deposits?: string;
  equity: string;
  margin: string;
  positions: Record<string, Position>;
  orders: Record<string, RestingOrder>;
  toxicity_bps: number;
  /** Each position's close-out; absent from a node that predates it. */
  closeouts?: PositionCloseout[];
  /** From V55, what closing each position pays now, keyed by market id; empty before V55 and absent from a node that predates it. */
  close_fees?: Record<string, CloseFee>;
  /** From V54, the toxicity score and the spread its tier adds; absent from a node that predates it. */
  toxicity?: ToxicityStandingWire;
  /** From V59, the volume tier, counted and pending volume, progress towards each tier and best-price bounds; from V66 the tier's order limit and request rate. */
  volume?: VolumeStandingWire;
}
