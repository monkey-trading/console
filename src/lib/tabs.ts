/** Keyboard movement along a horizontal tab list (the WAI-ARIA tabs pattern). */

/** A key press as the tab list sees it: the key and the modifiers held. */
export interface TabKeyPress {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * The index of the tab `press` moves to from `index` among `count` tabs, wrapping at the ends; null
 * for a key that moves nowhere. A press with Alt, Ctrl, Meta or Shift held moves nowhere: the browser's
 * own shortcuts (Alt+Left to go back, Cmd+Left, Ctrl+Home) use the same keys.
 */
export function tabAfterKey(press: TabKeyPress, index: number, count: number): number | null {
  if (press.altKey || press.ctrlKey || press.metaKey || press.shiftKey) return null;
  switch (press.key) {
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowLeft":
      return (index + count - 1) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
