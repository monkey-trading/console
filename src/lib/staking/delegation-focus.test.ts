/** Tests for where focus goes when a delegation lands (monkey-trading/console#327). */

import { describe, expect, it } from "vitest";

import { editorOwnsFocusLoss, type EditorElement } from "./delegation-focus";

/** A stand-in for an editor element holding `inside` nodes. */
const editor = (version: number, inside: unknown[], isConnected = true): EditorElement => ({
  isConnected,
  contains: (node) => inside.includes(node),
  getAttribute: (name) => (name === "data-delegation-editor" ? String(version) : null),
});

const BODY = { tag: "body" };
const AMOUNT = { tag: "amount field" };
const MAX = { tag: "Max" };
const SEARCH = { tag: "search outside" };
const OTHER = { tag: "another editor's field" };

describe("editorOwnsFocusLoss", () => {
  it("claims focus still inside the sending editor, wherever in it it moved, since the editor closes", () => {
    const sending = editor(4, [AMOUNT, MAX]);
    expect(editorOwnsFocusLoss(sending, AMOUNT, BODY, 4)).toBe(true);
    // Tabbed from the amount field to Max while the send waited.
    expect(editorOwnsFocusLoss(sending, MAX, BODY, 4)).toBe(true);
  });

  it("claims focus that fell to the document once the refreshed read removed the editor with its row", () => {
    const removed = editor(4, [AMOUNT], false);
    expect(editorOwnsFocusLoss(removed, BODY, BODY, 4)).toBe(true);
    expect(editorOwnsFocusLoss(removed, null, BODY, 4)).toBe(true);
  });

  it("leaves focus the visitor moved to a control outside the editor, or to another editor, where it is", () => {
    expect(editorOwnsFocusLoss(editor(4, [AMOUNT]), SEARCH, BODY, 4)).toBe(false);
    expect(editorOwnsFocusLoss(editor(4, [AMOUNT]), OTHER, BODY, 4)).toBe(false);
    expect(editorOwnsFocusLoss(editor(4, [AMOUNT], false), SEARCH, BODY, 4)).toBe(false);
  });

  it("leaves a click on the page's background alone while the sending editor is still there", () => {
    expect(editorOwnsFocusLoss(editor(4, [AMOUNT]), BODY, BODY, 4)).toBe(false);
  });

  it("claims nothing for a send pressed outside any editor, or for an editor since replaced by a newer instance", () => {
    expect(editorOwnsFocusLoss(null, BODY, BODY, 4)).toBe(false);
    expect(editorOwnsFocusLoss(editor(5, [AMOUNT]), AMOUNT, BODY, 4)).toBe(false);
    expect(editorOwnsFocusLoss(editor(5, [AMOUNT], false), BODY, BODY, 4)).toBe(false);
  });
});
