/** Tests for which delegation form is open and what its Move form carries (monkey-trading/console#302). */

import { describe, expect, it } from "vitest";

import { CLOSED_FORM, openForm } from "./delegation-form";

const A = "0x00000000000000000000000000000000000000a1";
const C = "0x00000000000000000000000000000000000000c3";
const B = "0x00000000000000000000000000000000000000b2";

describe("openForm", () => {
  it("starts another delegation's form afresh: no destination chosen or address typed under the last one", () => {
    const moving = { editing: { candidate: A, mode: "move" as const }, moveTo: B, typedMove: "0x12" };
    const closed = openForm(moving, null);
    expect(closed).toEqual({ form: { ...CLOSED_FORM }, fresh: true });
    expect(openForm(moving, { candidate: C, mode: "move" })).toEqual({ form: { editing: { candidate: C, mode: "move" }, moveTo: null, typedMove: "" }, fresh: true });
  });

  it("keeps what this delegation's form holds when it switches between Move and Take back", () => {
    const moving = { editing: { candidate: A, mode: "move" as const }, moveTo: B, typedMove: "" };
    expect(openForm(moving, { candidate: A, mode: "undelegate" })).toEqual({ form: { editing: { candidate: A, mode: "undelegate" }, moveTo: B, typedMove: "" }, fresh: false });
  });
});
