/** Tests for the notice text the mock's controls accept, held to what the engine refuses. */

import { describe, expect, it } from "vitest";

import { MAX_NOTICE_CHARS, noticeProblem } from "./notice-text";

describe("noticeProblem", () => {
  it.each([
    "Security maintenance: withdrawals are paused",
    "Markets are reduce-only. Visit monkey.trading for updates",
    "x".repeat(MAX_NOTICE_CHARS),
    "\u{1F412}".repeat(MAX_NOTICE_CHARS),
  ])("accepts %#", (text) => {
    expect(noticeProblem(text)).toBeNull();
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    [" padded", "begin or end with a space"],
    ["padded ", "begin or end with a space"],
    ["x".repeat(MAX_NOTICE_CHARS + 1), "exceed 280"],
    ["two\nlines", "control characters"],
    ["zero​width", "control characters"],
    ["line separator", "control characters"],
    ["<b>bold</b>", "characters"],
    ["fish & chips", "characters"],
    ["see [here]", "characters"],
    ["see https://example.com", "link"],
    ["see WWW.example.com", "link"],
    ["write to mailto:a@b.c", "link"],
  ])("refuses %j", (text, why) => {
    expect(noticeProblem(text)).toContain(why);
  });
});
