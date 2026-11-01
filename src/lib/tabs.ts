/** Keyboard movement along a horizontal tab list (the WAI-ARIA tabs pattern). */

/** The index of the tab `key` moves to from `index` among `count` tabs, wrapping at the ends; null for a key that moves nowhere. */
export function tabAfterKey(key: string, index: number, count: number): number | null {
  switch (key) {
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
