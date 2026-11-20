/** Noticing that something hidden has been shown. */

/**
 * Calls `onShown` each time `isShown` turns from false to true, checked at the start and whenever `changes` calls the check it
 * is given, and never while it stays shown or stays hidden. Returns what stops the watching. A pane that is revealed changes no
 * state of its owner's, so whoever waited for it learns from the change that revealed it.
 */
export function onBecomingShown(isShown: () => boolean, changes: (check: () => void) => () => void, onShown: () => void): () => void {
  let was = isShown();
  return changes(() => {
    const now = isShown();
    if (now && !was) onShown();
    was = now;
  });
}
