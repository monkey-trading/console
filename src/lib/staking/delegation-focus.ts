/**
 * Where focus goes when a delegation lands (monkey-trading/console#327): the editor that sent it
 * closes, taking whatever focus it held. Focus the visitor deliberately moved to another editor or a
 * control outside the sending one stays where it is.
 */

/** What this needs of the editor element the send was pressed in; a DOM element satisfies it. */
export interface EditorElement {
  isConnected: boolean;
  contains(node: unknown): boolean;
  getAttribute(name: string): string | null;
}

/**
 * Whether the loss of focus at a landed send belongs to the editor that sent it: `origin`, the editor
 * holding focus when the send was pressed, still holds it — the field the visitor tabbed to, Max
 * for one — or has been removed with the row it sat under and focus fell to the document. An
 * editor replaced by a newer instance (`version` no longer its own) does not own what the newer one
 * holds, and focus on any other control is the visitor's.
 */
export function editorOwnsFocusLoss(origin: EditorElement | null, active: unknown, body: unknown, version: number): boolean {
  if (origin === null || origin.getAttribute("data-delegation-editor") !== String(version)) return false;
  if (active === null || active === body) return !origin.isConnected;
  return origin.contains(active);
}
