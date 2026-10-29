/** Tests for which Escape presses close a popup. */

import { describe, expect, it } from "vitest";

import { closesOnEscape, type EscapePress } from "./escape";

const press = (over: Partial<EscapePress>): EscapePress => ({
  key: "Escape",
  defaultPrevented: false,
  inside: false,
  onBody: false,
  modalElsewhere: false,
  ...over,
});

describe("closesOnEscape", () => {
  it("closes on Escape from inside the popup", () => {
    expect(closesOnEscape(press({ inside: true }))).toBe(true);
  });

  it("closes on Escape from the body, where Safari leaves focus after a pointer click", () => {
    expect(closesOnEscape(press({ onBody: true }))).toBe(true);
  });

  it("leaves an Escape from the body to a modal dialog that does not hold the popup", () => {
    expect(closesOnEscape(press({ onBody: true, modalElsewhere: true }))).toBe(false);
  });

  it("closes on Escape from inside the popup even while another modal is open", () => {
    expect(closesOnEscape(press({ inside: true, modalElsewhere: true }))).toBe(true);
  });

  it("ignores an Escape from elsewhere in the page", () => {
    expect(closesOnEscape(press({}))).toBe(false);
  });

  it("ignores other keys and an Escape that something already handled", () => {
    expect(closesOnEscape(press({ inside: true, key: "Enter" }))).toBe(false);
    expect(closesOnEscape(press({ inside: true, defaultPrevented: true }))).toBe(false);
  });
});
