/**
 * Where focus was in the trading view when trading paused, told by what a trader sees of the control, since a move to another server
 * remounts every screen and no element survives it; and putting focus back there once the view is enabled again.
 */

import type { FocusPlace } from "@/lib/store/trading-pause";

/** What a trader reads as the control's name: its label, the label tied to it, or its text. */
function nameOf(element: Element): string {
  const labelled = element.getAttribute("aria-label");
  const labels = "labels" in element && element.labels instanceof NodeList ? element.labels : null;
  return (labelled ?? labels?.[0]?.textContent ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The place of `element` when it is a named control inside `within`, or null. */
export function placeOf(element: Element | null, within: Element | null): FocusPlace | null {
  if (element === null || within === null || !within.contains(element) || element === within) return null;
  const name = nameOf(element);
  return name === "" ? null : { tag: element.tagName, name };
}

/** Focuses the first control inside `within` at `place`, or else the page's main region, unless the trader has put focus somewhere since. */
export function focusPlace(place: FocusPlace | null, within: Element): void {
  if (document.activeElement !== null && document.activeElement !== document.body) return;
  const match = place === null ? undefined : [...within.querySelectorAll(place.tag)].find((element) => nameOf(element) === place.name);
  if (match instanceof HTMLElement) match.focus();
  else document.getElementById("main")?.focus();
}
