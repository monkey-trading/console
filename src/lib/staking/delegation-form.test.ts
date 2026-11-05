/** Tests for the Delegate tab's editing context: one editor at a time, nothing carried between rows, amounts kept per editor (monkey-trading/console#309). */

import { describe, expect, it } from "vitest";

import {
  amountKey,
  clearAmount,
  closeEditor,
  editingFor,
  keptFor,
  NO_EDITING,
  openRowEditor,
  openTypedEditor,
  setAmount,
  setMoveTo,
  setTypedMove,
  setTypedTo,
  TYPED_EDITOR,
  type EditingState,
  type EditingUpdate,
} from "./delegation-form";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";

describe("openRowEditor", () => {
  it("starts another row's editor afresh: no destination chosen or address typed under the last row", () => {
    const moving = { ...NO_EDITING, editing: { candidate: A, mode: "move" as const }, moveTo: B, typedMove: "0x12" };
    expect(openRowEditor(moving, { candidate: C, mode: "move" })).toEqual({ ...moving, editorVersion: moving.editorVersion + 1, editing: { candidate: C, mode: "move" }, moveTo: "", typedMove: "" });
    expect(openRowEditor(moving, null)).toEqual({ ...moving, editorVersion: moving.editorVersion + 1, editing: null, moveTo: "", typedMove: "" });
  });

  it("keeps what the same row's Move form holds when it switches to Take back", () => {
    const moving = { ...NO_EDITING, editing: { candidate: A, mode: "move" as const }, moveTo: B, typedMove: "" };
    expect(openRowEditor(moving, { candidate: A, mode: "undelegate" })).toEqual({ ...moving, editorVersion: moving.editorVersion + 1, editing: { candidate: A, mode: "undelegate" } });
  });

  it("closes the typed-address editor, and opening it closes a row editor: one editor at a time", () => {
    const typed = openTypedEditor(NO_EDITING, true);
    expect(openRowEditor(typed, { candidate: A, mode: "delegate" }).typedOpen).toBe(false);
    const row = openRowEditor(NO_EDITING, { candidate: A, mode: "delegate" });
    expect(openTypedEditor(row, true)).toEqual({ ...row, editorVersion: row.editorVersion + 1, editing: null, typedOpen: true });
  });

  it("keeps typed amounts across opens and closes: they are kept per editor, so none carries to another row", () => {
    const withAmounts = { ...NO_EDITING, amounts: { [amountKey("delegate", A)]: "10", [amountKey("undelegate", B)]: "5" } };
    const opened = openRowEditor(withAmounts, { candidate: C, mode: "delegate" });
    expect(opened.amounts).toEqual(withAmounts.amounts);
    expect(closeEditor(opened).amounts).toEqual(withAmounts.amounts);
  });
});

describe("the Move form's destination and typed addresses", () => {
  it("choosing a destination clears what was typed under it, and typing holds until a choice replaces it", () => {
    const typed = setTypedMove(NO_EDITING, "0x1234");
    expect(setMoveTo(typed, B)).toEqual({ ...NO_EDITING, moveTo: B, typedMove: "" });
    expect(setTypedMove(setMoveTo(NO_EDITING, B), "0x1234")).toEqual({ ...NO_EDITING, moveTo: B, typedMove: "0x1234" });
  });

  it("keeps the typed-address editor's address across row editors: it holds once the node's list is back", () => {
    const typed = setTypedTo(NO_EDITING, "0x1234");
    expect(openRowEditor(typed, { candidate: A, mode: "delegate" }).typedTo).toBe("0x1234");
    expect(closeEditor(typed).typedTo).toBe("0x1234");
  });
});

describe("amounts", () => {
  it("keeps what each editor typed under its own key, and clears only what was sent", () => {
    let state = setAmount(NO_EDITING, amountKey("delegate", A), "10");
    state = setAmount(state, amountKey("move", A), "7");
    state = setAmount(state, amountKey("delegate", TYPED_EDITOR), "3");
    expect(state.amounts).toEqual({ [amountKey("delegate", A)]: "10", [amountKey("move", A)]: "7", [amountKey("delegate", TYPED_EDITOR)]: "3" });
    expect(clearAmount(state, amountKey("delegate", A), "10").amounts[amountKey("delegate", A)]).toBe("");
    // Something else typed since: the landed send does not clear it.
    expect(clearAmount(state, amountKey("delegate", A), "12")).toBe(state);
  });

  it("lowercases a candidate's address in its key, so the same row shares its amount across cases", () => {
    expect(amountKey("delegate", A.toUpperCase().replace("0X", "0x"))).toBe(amountKey("delegate", A));
  });
});

describe("the account-keyed store (editingFor and keptFor)", () => {
  const stored = (account: string | null, editing = NO_EDITING): EditingState => ({ account, editing });
  const withAmount = setAmount(NO_EDITING, amountKey("delegate", A), "10");

  it("masks another account's context, and keeps this account's across a disconnect and back", () => {
    const held = stored(A, withAmount);
    expect(editingFor(held, B)).toBe(NO_EDITING);
    expect(editingFor(held, null)).toBe(NO_EDITING);
    expect(editingFor(held, A)).toBe(withAmount);
  });

  it("stores a write under the account connected when it is made, whatever was stored before", () => {
    expect(keptFor(B, withAmount, stored(A))).toEqual({ account: B, editing: withAmount });
    expect(keptFor(null, withAmount, stored(A))).toEqual({ account: null, editing: withAmount });
  });

  it("a landed send leaves the amount empty and the editor closed, applied to what is stored now", () => {
    const key = amountKey("delegate", A);
    let held = keptFor(A, openRowEditor(NO_EDITING, { candidate: A, mode: "delegate" }), stored(A));
    held = keptFor(A, setAmount(held.editing, key, "10"), held);
    // The send lands: the amount clears at once, and the editor closes once the re-reads finish.
    held = keptFor(A, (now) => clearAmount(now, key, "10"), held);
    held = keptFor(A, (now) => closeEditor(now), held);
    expect(held.editing.editing).toBeNull();
    expect(held.editing.typedOpen).toBe(false);
    expect(held.editing.amounts[key]).toBe("");
  });

  it("what was typed elsewhere while the wallet prompt was up is not overwritten by the landed send", () => {
    const keyA = amountKey("delegate", A);
    const keyB = amountKey("undelegate", B);
    let held = keptFor(A, openRowEditor(NO_EDITING, { candidate: A, mode: "delegate" }), stored(A));
    held = keptFor(A, setAmount(held.editing, keyA, "10"), held);
    const submittedVersion = held.editing.editorVersion;
    // The wallet prompt is up: the visitor opens bravo's Take back and types 5.
    held = keptFor(A, openRowEditor(held.editing, { candidate: B, mode: "undelegate" }), held);
    held = keptFor(A, setAmount(held.editing, keyB, "5"), held);
    held = keptFor(A, (now) => clearAmount(now, keyA, "10"), held);
    held = keptFor(A, (now) => closeEditor(now, submittedVersion), held);
    expect(held.editing.editing).toEqual({ candidate: B, mode: "undelegate" });
    expect(held.editing.amounts[keyA]).toBe("");
    expect(held.editing.amounts[keyB]).toBe("5");
  });

  it("ignores a setter retained by another account, before or after that account edits", () => {
    let connected: string | null = A;
    let held = stored(A, withAmount);
    const captured = (next: EditingUpdate) => { held = keptFor(A, next, held, connected); };
    for (const account of [B, null]) {
      connected = account;
      const before = held;
      captured((now) => clearAmount(now, amountKey("delegate", A), "10"));
      captured((now) => closeEditor(now));
      expect(held).toBe(before);
    }
    connected = B;
    held = keptFor(B, openRowEditor(withAmount, { candidate: B, mode: "delegate" }), held, connected);
    const before = held;
    captured((now) => clearAmount(now, amountKey("delegate", A), "10"));
    captured((now) => closeEditor(now));
    expect(held).toBe(before);
    expect(held.editing.editing).toEqual({ candidate: B, mode: "delegate" });
  });

  it("does not close a different editor, or a reopened instance of the same row or typed editor", () => {
    for (const typed of [false, true]) {
      const sent = typed ? openTypedEditor(NO_EDITING, true) : openRowEditor(NO_EDITING, { candidate: A, mode: "delegate" });
      expect(closeEditor(sent, sent.editorVersion).editing).toBeNull();
      expect(closeEditor(sent, sent.editorVersion).typedOpen).toBe(false);
      const other = openRowEditor(sent, { candidate: B, mode: "delegate" });
      expect(closeEditor(other, sent.editorVersion)).toBe(other);
      const closed = closeEditor(sent);
      const reopened = typed ? openTypedEditor(closed, true) : openRowEditor(closed, { candidate: A, mode: "delegate" });
      expect(closeEditor(reopened, sent.editorVersion)).toBe(reopened);
    }
  });
});
