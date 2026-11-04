/** What the closed-epochs card says about where the node's record begins and about a read that failed (monkey-trading/console#279). */

import { formatStamp } from "../time";
import type { EpochCover, EpochsState } from "./epoch-reads";

/** Where the node's record begins, which bounds what the list can show; null when it holds every epoch. */
export function coverText(cover: EpochCover): string | null {
  if (cover.truncated) return `The node keeps the newest epochs only, from epoch ${cover.retained_from_epoch ?? "—"} on.`;
  if (!cover.from_genesis && cover.begins_ms !== null) return `The node's record of closes begins at ${formatStamp(cover.begins_ms)} UTC; earlier epochs are not listed.`;
  return null;
}

/**
 * A read that failed while epochs are held, or a failed Load more: one status line that changes its
 * words, so each is announced. Empty while the list is not shown, whose own line says why.
 */
export function problemText(state: Pick<EpochsState, "status" | "error" | "moreError">): string {
  if (state.status !== "ready") return "";
  if (state.error !== null) return `Could not check for newly closed epochs: ${state.error.replace(/\.+$/, "")}. The check is made again by itself.`;
  return state.moreError === null ? "" : `Could not read older epochs: ${state.moreError.replace(/\.+$/, "")}.`;
}
