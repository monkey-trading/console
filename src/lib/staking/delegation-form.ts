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
  /** Changes whenever an editor opens or closes, so an old completion cannot close a newer instance. */
  editorVersion: number;
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

export const NO_EDITING: DelegateEditing = { editorVersion: 0, editing: null, typedOpen: false, moveTo: "", typedMove: "", typedTo: "", amounts: {} };

/**
 * A write to the editing context: the next context, or an updater applied to what is stored now —
 * a send that lands after other edits must not restore what a render captured when it was pressed.
 */
export type EditingUpdate = DelegateEditing | ((prev: DelegateEditing) => DelegateEditing);

/** The editing context as the Staking section stores it, with the account it belongs to. */
export interface EditingState {
  account: string | null;
  editing: DelegateEditing;
}

/** What the account connected now reads of the stored context: its own, or none. */
export function editingFor(held: EditingState, account: string | null): DelegateEditing {
  return held.account === account ? held.editing : NO_EDITING;
}

/**
 * Applies a render's write only while its account is still connected; an updater reads that
 * account's current context, never another account's.
 */
export function keptFor(account: string | null, next: EditingUpdate, held: EditingState, connected = account): EditingState {
  if (account !== connected) return held;
  const editing = typeof next === "function" ? next(editingFor(held, account)) : next;
  return { account, editing };
}

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
    editorVersion: state.editorVersion + 1,
    editing: next,
    typedOpen: false,
    moveTo: sameRow ? state.moveTo : "",
    typedMove: sameRow ? state.typedMove : "",
  };
}

/** Opens or closes the "Delegate to an address" editor; it is the one editor, so a row editor closes. */
export function openTypedEditor(state: DelegateEditing, open: boolean): DelegateEditing {
  return { ...state, editorVersion: state.editorVersion + 1, editing: null, typedOpen: open };
}

/** Closes the submitted editor instance, if still open; what was typed stays for its next opening. */
export function closeEditor(state: DelegateEditing, submittedVersion = state.editorVersion): DelegateEditing {
  if (state.editorVersion !== submittedVersion) return state;
  return { ...state, editorVersion: state.editorVersion + 1, editing: null, typedOpen: false };
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
