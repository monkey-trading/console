/** Which workspace pane to show when the layout narrows, so focus held in a pane survives it hiding the others. */

/** Where a focus change landed: in a pane of the workspace, in a dialog opened over it, or anywhere else. */
export type FocusWhere<P extends string> = { kind: "pane"; pane: P } | { kind: "dialog" } | { kind: "elsewhere" };

/**
 * The pane that holds the user's place. A dialog opened from a pane leaves it standing, so closing
 * the dialog can return focus there; focus anywhere else means no pane holds it.
 */
export function rememberPane<P extends string>(remembered: P | null, where: FocusWhere<P>): P | null {
  if (where.kind === "pane") return where.pane;
  return where.kind === "dialog" ? remembered : null;
}

/** The pane to show once only one fits: the one that holds the user's place, else the one already chosen. */
export function paneWhenNarrowed<P extends string>(chosen: P, remembered: P | null): P {
  return remembered ?? chosen;
}
