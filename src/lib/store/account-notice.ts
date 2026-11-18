/** What the account notice says of a stream message: what happened to the account that no control the trader pressed can say. */

import type { MarketId, StreamMessage } from "../engine/types";
import type { HouseParams } from "../house";
import { levelClosedSentence } from "../level-words";
import { isMine } from "./feed";

/**
 * The notice for `message`, or null: a close-out first, then a take profit or stop loss that closed a
 * position (from V79), then resting orders the node cancelled later on a tick. Each leaves the trader with
 * less than they placed and no control to say why.
 */
export function accountNotice(message: StreamMessage, viewer: string | undefined, params: HouseParams | null, symbolOf: (id: MarketId) => string): string | null {
  const closedOut = message.events.some((event) => event.type === "close_out" && isMine(event, viewer));
  if (closedOut) return `Your positions were closed out because your equity fell below the close-out level${params === null ? "" : ` of ${params.closeoutLevelBps / 100}% of your margin requirement`}. They were closed at the market price, and the details are shown in History.`;
  const reached = message.events.flatMap((event) => {
    if (event.type !== "position_level_triggered" || !isMine(event, viewer)) return [];
    const fill = message.events.find((e) => e.type === "fill" && e.order_id === event.order_id);
    return [levelClosedSentence(event.level, symbolOf(event.market), event.price, fill?.type === "fill" ? fill.price : null)];
  });
  if (reached.length > 0) return `${reached.join(" ")} The details are shown in History.`;
  const cancelled = message.events.flatMap((event) => (event.type === "order_cancelled" && event.reason !== "client" && isMine(event, viewer) ? [event.order_id] : []));
  if (cancelled.length === 0) return null;
  return `${cancelled.length === 1 ? `Order ${cancelled[0]}` : `Orders ${cancelled.join(", ")}`} could not be filled, so ${cancelled.length === 1 ? "it has" : "they have"} been cancelled.`;
}
