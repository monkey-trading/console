/** Which Escape key presses close a popup that sits beside the page's controls. */

/** What the popup knows about a key press. */
export interface EscapePress {
  key: string;
  defaultPrevented: boolean;
  /** The press came from inside the popup or its toggle. */
  inside: boolean;
  /** The press came from the document body, which holds focus after a pointer click in Safari. */
  onBody: boolean;
  /** A modal dialog that does not contain the popup is open, and Escape belongs to it. */
  modalElsewhere: boolean;
}

/** True when the popup closes: Escape that nothing handled, from inside it or from the body with no other modal open. */
export function closesOnEscape(press: EscapePress): boolean {
  if (press.key !== "Escape" || press.defaultPrevented) return false;
  return press.inside || (press.onBody && !press.modalElsewhere);
}
