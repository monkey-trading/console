/** Portfolio margin on the wire: the account read's `portfolio_margin` (V81), the parameters' `portfolio_grid`, and the order preview (V84). */

import type { Address, MarketId, Reject, Side } from "./types";

/** One offset group's part of an account's portfolio requirement at the market's bands, as `engine_core::portfolio::GroupStanding` serializes it. */
export interface OffsetGroupWire {
  /** The group's markets the account holds, in the grid's order. */
  members: MarketId[];
  /** The loading-weighted net notional, in USD. */
  net_notional: string;
  /** The matched exposure: the gross loading-weighted exposure less the net's magnitude. */
  matched_notional: string;
  worst_loss: string;
  binding_direction: "down" | "up" | "either";
  /** What the group takes off the per-position requirement. */
  offset: string;
}

/** The account read's `portfolio_margin`, present while the parameters name a grid. */
export interface PortfolioMarginWire {
  /** The per-position requirement at the market's bands less each group's credit. */
  margin: string;
  /** The same at initial bands: the requirement new risk and withdrawals meet. */
  initial_margin: string;
  /** The close-out level's share of `margin`. */
  maintenance_margin: string;
  /** Each group the account holds a member of, by the grid's name for it. */
  groups: Record<string, OffsetGroupWire>;
}

/** One market of an offset group in the parameters' grid. */
export interface GroupMemberWire {
  market: MarketId;
  /** How far the member moves with the group's factor, a decimal of either sign. */
  loading: string;
  residual_shock_bps: number;
  max_residual_shock_bps: number;
}

/** One offset group in the parameters' grid. */
export interface OffsetGroupGridWire {
  name: string;
  floor_share_bps: number;
  max_floor_share_bps: number;
  members: GroupMemberWire[];
}

/** The parameters' `portfolio_grid`, from V81: the offset groups close-outs, and from V84 new risk and withdrawals, read. */
export interface PortfolioGridWire {
  groups: OffsetGroupGridWire[];
}

/** What `GET /v1/accounts/{address}/preview` asks about: a market order of exactly `qty`. */
export interface OrderPreviewRequest {
  account: Address;
  market: MarketId;
  side: Side;
  /** A decimal quantity, as an order sends it. */
  qty: string;
  reduceOnly: boolean;
}

/** `GET /v1/accounts/{address}/preview` (V84): what a market order of an exact size would do now. */
export interface OrderPreviewWire {
  seq: number;
  account: Address;
  market: MarketId;
  side: Side;
  qty: string;
  reduce_only: boolean;
  /** The fill, or null when the order cannot be priced, `refused` then saying why. */
  fill: { qty: string; price: string; mid: string; spread_bps: number; increases: boolean } | null;
  /** The account after the fill, or as it is now when there is no fill. */
  equity: string;
  initial_margin: string;
  maintenance_margin: string;
  /** Why the order would be rejected, or null when it would be executed. */
  refused: Reject | null;
}
