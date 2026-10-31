/** The activity feed: which events are the viewer's, and how a batch of stream messages becomes feed lines. */

import type { EngineEvent, MarketId, StreamMessage } from "../engine/types";
import { describeEvent } from "../messages";
import type { FeedLine } from "./state";

export const FEED_LIMIT = 150;

/** Whether an event belongs in this user's activity: market events, and events of their own account. */
export function isMine(event: EngineEvent, mine: string | undefined): boolean {
  if (!("account" in event)) return true;
  return mine !== undefined && event.account.toLowerCase() === mine.toLowerCase();
}

/** Activity lines for a batch of messages, newest first, as the stream handler adds them; `nextId` numbers each line. */
export function feedFrom(messages: readonly StreamMessage[], markets: readonly { id: MarketId; symbol: string }[], mine: string | undefined, nextId: () => number): FeedLine[] {
  const symbolOf = (id: MarketId) => markets.find((m) => m.id === id)?.symbol ?? `market ${id}`;
  const lines = messages.flatMap((message) =>
    message.events.flatMap((event) => {
      if (!isMine(event, mine)) return [];
      const text = describeEvent(event, symbolOf);
      return text === null ? [] : [{ id: nextId(), ts: message.ts, text, ...("account" in event ? { account: event.account.toLowerCase() } : {}) }];
    }),
  );
  return lines.reverse().slice(0, FEED_LIMIT);
}
