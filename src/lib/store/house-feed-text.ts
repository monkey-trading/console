/** What a dashboard panel says when its feed is not simply ready: one calm line, written for the reader. */

import type { FeedState } from "./house-stats";

/**
 * The line a panel shows beside (or in place of) its figures, or null when the feed is current.
 * A feed that never answered says so, instead of letting the panel claim an empty book; a feed that
 * answered before and then failed or stopped being served keeps its figures and says they are old.
 */
export function feedProblem(feed: FeedState<unknown>, what: string): string | null {
  if (feed.status === "failed") return `The node did not answer for ${what}${feed.error === null ? "" : ` (${feed.error})`}, so there is nothing to show yet. The page keeps asking.`;
  if (!feed.stale) return null;
  if (feed.error !== null) return `The last read of ${what} failed, so this may be behind.`;
  if (feed.status === "waiting") return `The node is rescanning, so this is the last it answered for ${what}.`;
  return `The node has stopped serving ${what}, so this is the last it answered.`;
}
