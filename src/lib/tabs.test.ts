/** Tests for the tab list's keyboard movement. */

import { describe, expect, it } from "vitest";

import { tabAfterKey } from "./tabs";

describe("tabAfterKey", () => {
  it("moves to the next tab on ArrowRight and wraps from the last to the first", () => {
    expect(tabAfterKey("ArrowRight", 0, 2)).toBe(1);
    expect(tabAfterKey("ArrowRight", 1, 2)).toBe(0);
    expect(tabAfterKey("ArrowRight", 2, 4)).toBe(3);
  });

  it("moves to the previous tab on ArrowLeft and wraps from the first to the last", () => {
    expect(tabAfterKey("ArrowLeft", 1, 2)).toBe(0);
    expect(tabAfterKey("ArrowLeft", 0, 2)).toBe(1);
    expect(tabAfterKey("ArrowLeft", 0, 4)).toBe(3);
  });

  it("jumps to the first tab on Home and the last on End", () => {
    expect(tabAfterKey("Home", 3, 4)).toBe(0);
    expect(tabAfterKey("End", 0, 4)).toBe(3);
  });

  it("leaves every other key alone, so Tab and Enter keep their meaning", () => {
    for (const key of ["Tab", "Enter", " ", "ArrowDown", "ArrowUp", "a"]) expect(tabAfterKey(key, 0, 2)).toBeNull();
  });
});
