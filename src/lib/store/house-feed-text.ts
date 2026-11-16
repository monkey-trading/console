/** What a dashboard panel says when its feed is not simply ready: one calm line, written for the reader. */

import { asSentence, errorText } from "../format";
import type { FeedState } from "./house-stats";

/**
 * The line a panel shows beside (or in place of) its figures, or null when the feed is current.
 * A feed that never answered says so, instead of letting the panel claim an empty book; a feed that
 * answered before and then failed or stopped being served keeps its figures and says they are old.
 */
export function feedProblem(feed: FeedState<unknown>, what: string): string | null {
  if (feed.status === "failed") return errorText(asSentence(`${what} could not be loaded`), feed.error, "The app will try again automatically.");
  if (!feed.stale) return null;
  if (feed.error !== null) return asSentence(`${what} could not be refreshed, so the information shown may be out of date`);
  if (feed.status === "waiting") return `The trading server is recalculating ${what}, so the information shown may be out of date.`;
  return `The trading server has stopped providing ${what}, so the information shown may be out of date.`;
}
