/** Tests for choosing the pane that keeps the user's place. */

import { describe, expect, it } from "vitest";

import { paneWhenNarrowed, rememberPane } from "./panes";

type Pane = "markets" | "chart" | "trade";

describe("rememberPane", () => {
  it("remembers the pane that took focus", () => {
    expect(rememberPane<Pane>("chart", { kind: "pane", pane: "trade" })).toBe("trade");
  });

  it("keeps the pane an open dialog was opened from, since focus inside the dialog says nothing about the panes", () => {
    expect(rememberPane<Pane>("trade", { kind: "dialog" })).toBe("trade");
    expect(rememberPane<Pane>(null, { kind: "dialog" })).toBeNull();
  });

  it("forgets the pane when focus moves to the rest of the page", () => {
    expect(rememberPane<Pane>("trade", { kind: "elsewhere" })).toBeNull();
  });
});

describe("paneWhenNarrowed", () => {
  it("shows the pane that held focus", () => {
    expect(paneWhenNarrowed<Pane>("chart", "trade")).toBe("trade");
  });

  it("keeps the chosen pane when no pane held focus", () => {
    expect(paneWhenNarrowed<Pane>("markets", null)).toBe("markets");
  });
});
