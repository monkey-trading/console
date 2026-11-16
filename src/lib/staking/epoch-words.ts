/** What the closed-epochs card says about where the node's record begins and about a read that failed (monkey-trading/console#279). */

import { asSentence } from "../format";
import { formatStamp } from "../time";
import type { EpochCover, EpochsState } from "./epoch-reads";

/** Where the node's record begins, which bounds what the list can show; null when it holds every epoch. */
export function coverText(cover: EpochCover): string | null {
  if (cover.truncated) return `Only recent staking periods are retained, from period ${cover.retained_from_epoch ?? "—"} onwards.`;
  if (!cover.from_genesis && cover.begins_ms !== null) return `This list begins at ${formatStamp(cover.begins_ms)} UTC, and earlier staking periods are not shown.`;
  return null;
}

/**
 * A read that failed while epochs are held, or a failed Load more: one status line that changes its
 * words, so each is announced. Empty while the list is not shown, whose own line says why.
 */
export function problemText(state: Pick<EpochsState, "status" | "error" | "moreError">): string {
  if (state.status !== "ready") return "";
  if (state.error !== null) return `The page could not check for newly ended staking periods. ${asSentence(state.error)} It will try again automatically.`;
  return state.moreError === null ? "" : `Older staking periods could not be loaded. ${asSentence(state.moreError)}`;
}

/**
 * What the card says beside epochs it holds when the node stopped serving the route: the list is
 * what was read before and no longer updates. Empty otherwise; with nothing held, the card's own
 * unavailable line says it.
 */
export function unavailableText(state: Pick<EpochsState, "status" | "epochs">): string {
  return state.status === "unavailable" && state.epochs.length > 0 ? "This trading server has stopped providing past staking periods, so this list is no longer updated." : "";
}
