/**
 * Take-profit and stop-loss levels on a position (from V79), field for field as `engine_core::levels`,
 * `engine_core::command::PositionLevelsRequest` and the node's account read serialize them: each level
 * is a decimal string, left out while it is not set.
 */

import type { Address, MarketId, OrderId, RequestAuth } from "./types";

/** Which of a position's levels. */
export type LevelKind = "take_profit" | "stop_loss";

/** Why a position's levels were removed (`engine_core::levels::LevelsRemoved`). */
export type LevelsRemovedReason = "closed" | "close_all" | "take_profit" | "stop_loss" | "close_out" | "weekend_close_out" | "split" | "reversed" | "not_opened";

/** A position's take profit and stop loss, as the account read lists them by market. */
export interface PositionLevelsWire {
  take_profit?: string;
  stop_loss?: string;
}

/** `POST /v1/positions/levels`: the position in `market` takes exactly the levels named, and one left out is removed. */
export interface PositionLevelsRequest {
  account: Address;
  market: MarketId;
  take_profit?: string;
  stop_loss?: string;
  auth?: RequestAuth;
}

/** The refusals levels add: a level closer than the market's minimum distance to `reference`, or levels before V79. */
export type LevelReject = { kind: "level_too_close"; level: string; min_distance_bps: number; reference: string } | { kind: "levels_unsupported" };

/** The events levels emit. */
export type LevelEvent =
  /** The levels a request, or the order whose fill left the position on its side, set; neither when a request removed them. */
  | { type: "position_levels_set"; account: Address; market: MarketId; take_profit?: string; stop_loss?: string }
  /** A level the position's closing price reached: `price` is the level, and `order_id`'s fill closes the position. */
  | { type: "position_level_triggered"; account: Address; market: MarketId; level: LevelKind; price: string; order_id: OrderId }
  /** The levels removed from the position, or that an order named for a position its fill did not leave, and why. */
  | { type: "position_levels_removed"; account: Address; market: MarketId; take_profit?: string; stop_loss?: string; reason: LevelsRemovedReason };
