/** The executable quotes the signed stream's `quotes` op delivers, field for field as `engine_core` serializes them. */

import type { Address, MarketId, Reject, Side } from "./types";

/** One step of an executable quote: the average price of an order of up to `qty`. */
export interface QuoteStep {
  qty: string;
  price: string;
  /** Why a fill of this size would be declined; absent when it fills. */
  declined?: Reject;
}

/** One account's executable quotes in one market, as the signed stream's `quotes` op delivers them. */
export interface MarketQuote {
  type: "quote";
  account: Address;
  market: MarketId;
  open: boolean;
  reduce_only: boolean;
  stress_level: number;
  /** From V54, the spread the account's toxicity adds to every price here, in bps; absent from a node that predates it. */
  toxicity_bps?: number;
  mark: string | null;
  /** Why the market has no price now; the sides are then empty. */
  unavailable?: Reject;
  /** What a buy pays, by size. */
  ask: QuoteStep[];
  /** What a sell receives, by size. */
  bid: QuoteStep[];
  /** The price of closing the account's whole position, if it holds one. */
  close: { side: Side; qty: string; price: string } | null;
}

