/** Tests for where an open listbox sits inside the viewport. */

import { describe, expect, it } from "vitest";

import { placeListbox, type PlacementInput } from "./listbox-placement";

const base: PlacementInput = {
  control: { left: 100, right: 228, top: 100, bottom: 144 },
  list: { width: 160, contentHeight: 200 },
  viewport: { width: 1280, height: 800 },
  margin: 8,
  align: "start",
};

describe("placeListbox", () => {
  it("leaves a list that fits where its anchor puts it, below the control", () => {
    expect(placeListbox(base)).toEqual({ shiftX: 0, maxWidth: 1264, above: false, maxHeight: 640 });
  });

  it("moves an end-anchored list that would cross the left edge back inside the margin, at 320px under enlarged text", () => {
    // The 640px minimum width of a list at doubled root text, capped to the viewport less its margins.
    const narrow = placeListbox({ ...base, control: { left: 190, right: 302, top: 100, bottom: 160 }, list: { width: 640, contentHeight: 200 }, viewport: { width: 320, height: 640 }, align: "end" });
    // Anchored to the control's end the list's left edge would be at -2: it is moved onto the margin, and spans the viewport less both.
    expect(narrow).toMatchObject({ maxWidth: 304, shiftX: 10 });
    expect(302 - 304 + narrow.shiftX).toBe(8);
  });

  it("moves a start-anchored list that would cross the right edge back inside it", () => {
    const placed = placeListbox({ ...base, control: { left: 1200, right: 1270, top: 100, bottom: 144 }, list: { width: 200, contentHeight: 200 } });
    expect(1200 + placed.shiftX + 200).toBe(1272);
    expect(placed.shiftX).toBe(-(1200 + 200 - 1272));
  });

  it("opens above when the options do not fit below and there is more room above, and takes the room it has", () => {
    const low = placeListbox({ ...base, control: { left: 100, right: 228, top: 600, bottom: 644 }, list: { width: 160, contentHeight: 400 } });
    expect(low).toMatchObject({ above: true, maxHeight: 584 });
    const cramped = placeListbox({ ...base, control: { left: 100, right: 228, top: 100, bottom: 144 }, list: { width: 160, contentHeight: 900 }, viewport: { width: 1280, height: 400 } });
    expect(cramped).toMatchObject({ above: false, maxHeight: 240 });
  });
});
