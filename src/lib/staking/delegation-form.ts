/**
 * The Delegate tab's editing context (monkey-trading/console#309): which row's editor is open, the
 * "Delegate to an address" editor, the Move form's destination and the amounts typed — held by the
 * Staking section, not the tab, so a tab switch loses none of it. One editor is open at a time, and
 * nothing chosen or typed under one row is another's: each editor's amount is kept under its own key.
 */

/** Which change a row's editor makes. */
export type EditorMode = "delegate" | "move" | "undelegate";

/** The Delegate tab's editing context, as the Staking section holds it across its tabs. */
export interface DelegateEditing {
  /** The row editor open, if any: the row's candidate and which change it makes. */
  editing: { candidate: string; mode: EditorMode } | null;
  /** Whether the "Delegate to an address" editor is open. */
  typedOpen: boolean;
  /** The Move form's chosen destination, "" for none chosen yet. */
  moveTo: string;
  /** The address typed under a Move form. */
  typedMove: string;
  /** The address typed in the "Delegate to an address" editor; it holds once the node's list is back. */
  typedTo: string;
  /** What each editor has typed, by `amountKey`; nothing typed under one row is another's. */
  amounts: Readonly<Record<string, string>>;
}

export const NO_EDITING: DelegateEditing = { editing: null, typedOpen: false, moveTo: "", typedMove: "", typedTo: "", amounts: {} };

/** The "Delegate to an address" editor's `amounts` candidate: no row, the address is typed. */
export const TYPED_EDITOR = "typed";

/** Where an editor keeps the amount typed in it: its mode and candidate. */
export function amountKey(mode: EditorMode, candidate: string): string {
  return `${mode}:${candidate.toLowerCase()}`;
}

/**
 * Opens `next` under its row, or closes the row editor for null. Opening a row editor closes the
 * typed-address one; a destination chosen or address typed under another row is not this one's, so
 * opening another row's editor starts it afresh, while a mode switch on the same row keeps what its
 * Move form holds. What was typed stays, under its own key.
 */
export function openRowEditor(state: DelegateEditing, next: DelegateEditing["editing"]): DelegateEditing {
  const sameRow = next?.candidate === state.editing?.candidate;
  return {
    ...state,
    editing: next,
    typedOpen: false,
    moveTo: sameRow ? state.moveTo : "",
    typedMove: sameRow ? state.typedMove : "",
  };
}

/** Opens or closes the "Delegate to an address" editor; it is the one editor, so a row editor closes. */
export function openTypedEditor(state: DelegateEditing, open: boolean): DelegateEditing {
  return { ...state, editing: null, typedOpen: open };
}

/** Closes whichever editor is open; what was typed stays for the next time it opens. */
export function closeEditor(state: DelegateEditing): DelegateEditing {
  return { ...state, editing: null, typedOpen: false };
}

/** Chooses the Move form's destination; what was typed under it is not this destination's. */
export function setMoveTo(state: DelegateEditing, candidate: string): DelegateEditing {
  return { ...state, moveTo: candidate, typedMove: "" };
}

/** Types an address under a Move form. */
export function setTypedMove(state: DelegateEditing, text: string): DelegateEditing {
  return { ...state, typedMove: text };
}

/** Types an address in the "Delegate to an address" editor. */
export function setTypedTo(state: DelegateEditing, text: string): DelegateEditing {
  return { ...state, typedTo: text };
}

/** Types an amount in the editor `key` names. */
export function setAmount(state: DelegateEditing, key: string, text: string): DelegateEditing {
  return { ...state, amounts: { ...state.amounts, [key]: text } };
}

/** Clears the amount `key` sent once it has landed, unless something else has been typed since. */
export function clearAmount(state: DelegateEditing, key: string, sent: string): DelegateEditing {
  if (state.amounts[key] !== sent) return state;
  return { ...state, amounts: { ...state.amounts, [key]: "" } };
}
