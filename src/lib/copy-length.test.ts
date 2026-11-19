/** Tests for how help text is counted against interface-copy's length limits. */

import { describe, expect, it } from "vitest";

import { countSentences, countWords, overLimit } from "./copy-length";

describe("countSentences", () => {
  it.each<[string, number]>([
    ["", 0],
    ["No fee without a profit", 1],
    ["The fee rate falls the longer the position is held.", 1],
    ["A take profit closes your position. A stop loss may fill at a worse price.", 2],
    // A decimal point, a price and a percentage end no sentence.
    ["The level 100,100.5 must be at least 0.3% beyond 99,980.5. Set it further.", 2],
    ["Is the market open? It is! Trade now.", 3],
    // A sentence ending in a quote or a parenthesis still ends there.
    ["It is closed at the bid (for a long position.) The rest follows.", 2],
    // Words after the last full stop are a sentence of their own.
    ["The position is open. Held for 3 minutes", 2],
  ])("counts %j as %i", (text, sentences) => {
    expect(countSentences(text)).toBe(sentences);
  });
});

describe("countWords", () => {
  it("counts each run between spaces that holds a letter or a digit, and no lone sign", () => {
    expect(countWords("A ≥ sign means the fee rate is about to fall — so $1,000.00 may change.")).toBe(14);
    expect(countWords("  ")).toBe(0);
  });
});

describe("overLimit", () => {
  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

  it("holds a tooltip to two sentences and 40 words", () => {
    expect(overLimit("tooltip", `${words(20)}. ${words(20)}.`)).toBeNull();
    expect(overLimit("tooltip", `${words(20)}. ${words(21)}.`)).toBe("2 sentences, 41 words");
    expect(overLimit("tooltip", "One. Two. Three.")).toBe("3 sentences, 3 words");
  });

  it("holds a note to two sentences, at any length", () => {
    expect(overLimit("note", `${words(40)}. ${words(40)}.`)).toBeNull();
    expect(overLimit("note", "One. Two. Three.")).toBe("3 sentences, 3 words");
  });
});
