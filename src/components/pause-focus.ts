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
 * As trading pauses: closes a dialog open over the page, which the paused view's `inert` does not reach and whose draft the move would drop
 * anyway, and gives the place focus is in then, or null when it is on nothing named.
 */
export function pausePlace(within: Element | null): FocusPlace | null {
  for (const dialog of within?.querySelectorAll("dialog[open]") ?? []) if (dialog instanceof HTMLDialogElement) dialog.close();
  const element = document.activeElement;
  if (element === null || within === null || !within.contains(element) || element === within) return null;
  const name = nameOf(element);
  return name === "" ? null : { tag: element.tagName, name, pane: element.closest("[data-pane]")?.getAttribute("data-pane") ?? null };
}

/** Focuses the first control inside `within` at `place`, or else `within` itself, unless the trader has put focus somewhere since. */
export function focusPlace(place: FocusPlace | null, within: HTMLElement): void {
  if (document.activeElement !== null && document.activeElement !== document.body) return;
  const match = place === null ? undefined : [...within.querySelectorAll(place.tag)].find((element) => nameOf(element) === place.name);
  if (match instanceof HTMLElement) match.focus();
  // A control that is gone, hidden or still inert takes no focus: the page's main region does.
  if (document.activeElement !== match) within.focus();
}
