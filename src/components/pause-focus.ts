/**
 * Where focus was when trading paused, told by what a trader sees of the control and the phone pane it sat in, since a move to another
 * server remounts every screen and no element survives it; and putting focus back there once the view is enabled again.
 */

import type { FocusPlace } from "@/lib/store/trading-pause";

/** What a trader reads as the control's name: its label, the label tied to it, or its text. */
function nameOf(element: Element): string {
  const labelled = element.getAttribute("aria-label");
  const labels = "labels" in element && element.labels instanceof NodeList ? element.labels : null;
  return (labelled ?? labels?.[0]?.textContent ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * As trading pauses: closes a dialog open over the trading view, which the paused view's `inert` does not reach and whose draft the move
 * would drop anyway, telling `closed` once each has run its own close handling, and gives the place focus is in then, or null when it is
 * on nothing named.
 */
export function pausePlace(within: Element | null, closed: () => void): FocusPlace | null {
  for (const dialog of within?.querySelectorAll("dialog[open]") ?? []) {
    if (!(dialog instanceof HTMLDialogElement)) continue;
    // After the dialog's own listener, which React added when it rendered: the close event is queued, so it runs later.
    dialog.addEventListener("close", closed, { once: true });
    dialog.close();
  }
  const element = document.activeElement;
  if (element === null || within === null || !within.contains(element) || element === within) return null;
  const name = nameOf(element);
  return name === "" ? null : { tag: element.tagName, name, pane: element.closest("[data-pane]")?.getAttribute("data-pane") ?? null };
}

/**
 * Focuses the first control inside `within` at `place` that takes focus, as a phone card's hidden twin of a table's control does not, or
 * else `within` itself, unless the trader has put focus somewhere since; the pause panel, about to leave, is not somewhere.
 */
export function focusPlace(place: FocusPlace | null, within: HTMLElement): void {
  const active = document.activeElement;
  if (active !== null && active !== document.body && active.closest("[data-pause-panel]") === null) return;
  if (place !== null) {
    for (const element of within.querySelectorAll(place.tag)) {
      if (!(element instanceof HTMLElement) || nameOf(element) !== place.name) continue;
      element.focus();
      if (document.activeElement === element) return;
    }
  }
  within.focus();
}
