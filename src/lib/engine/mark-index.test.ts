/** Tests for the chart's replay of the engine's index rule from the log's `prices` commands. */

import { describe, expect, it } from "vitest";

import { fixedFromWire } from "../fixed";
import { foldQuotes, indexOf, type QuoteBook } from "./mark-index";
import type { PriceRules, SourceQuote } from "./types";

const RULES: PriceRules = { max_age_ms: 500, max_divergence_bps: 20, min_sources: 2 };

const quotes = (qs: [string, string, number][]): SourceQuote[] => qs.map(([source, mid, ts]) => ({ source, mid, ts }));

describe("indexOf", () => {
  it("is the median of the fresh sources, and averages the middle pair on an even count", () => {
    const book = foldQuotes({}, 1, quotes([["a", "100", 1_000], ["b", "100.1", 1_000], ["c", "100.05", 1_000]]), 1_000);
    expect(indexOf(book[1], RULES, 1_200)).toBe(100.05);
    const two = foldQuotes({}, 1, quotes([["a", "100", 1_000], ["b", "100.1", 1_000]]), 1_000);
    expect(indexOf(two[1], RULES, 1_000)).toBe(100.05);
  });

  it("averages the central pair on four and six sources", () => {
    const wide = { ...RULES, max_divergence_bps: 100 };
    const four = foldQuotes({}, 1, quotes([["a", "100", 1_000], ["b", "100.1", 1_000], ["c", "100.2", 1_000], ["d", "100.3", 1_000]]), 1_000);
    expect(indexOf(four[1], wide, 1_000)).toBe((100.1 + 100.2) / 2);
    const six = foldQuotes({}, 1, quotes([["a", "100", 1_000], ["b", "100.1", 1_000], ["c", "100.2", 1_000], ["d", "100.3", 1_000], ["e", "100.4", 1_000], ["f", "100.5", 1_000]]), 1_000);
    expect(indexOf(six[1], wide, 1_000)).toBe((100.2 + 100.3) / 2);
  });

  it("counts a source exactly max-age old as fresh, and one a millisecond older as stale", () => {
    const book = foldQuotes({}, 1, quotes([["a", "100", 500], ["b", "100.2", 1_000], ["c", "100.1", 1_000]]), 1_000);
    expect(indexOf(book[1], RULES, 1_000)).toBe(100.1);
    const stale = foldQuotes({}, 1, quotes([["a", "100", 499], ["b", "100.1", 100], ["c", "100.2", 1_000]]), 1_000);
    expect(indexOf(stale[1], RULES, 1_000)).toBeNull();
  });

  it("answers null with fewer fresh sources than the market names, and when fresh sources diverge", () => {
    const one = foldQuotes({}, 1, quotes([["a", "100", 1_000], ["b", "100.1", 100]]), 1_000);
    expect(indexOf(one[1], RULES, 1_000)).toBeNull();
    const far = foldQuotes({}, 1, quotes([["a", "100", 1_000], ["b", "101", 1_000]]), 1_000);
    expect(indexOf(far[1], RULES, 1_000)).toBeNull();
  });

  it("prices a spread truncated to exactly the divergence limit, and refuses one wider", () => {
    const at = foldQuotes({}, 1, quotes([["a", "100.125", 1_000], ["b", "100.328125", 1_000]]), 1_000);
    expect(indexOf(at[1], RULES, 1_000)).toBe(100.2265625);
    const over = foldQuotes({}, 1, quotes([["a", "100.125", 1_000], ["b", "100.421875", 1_000]]), 1_000);
    expect(indexOf(over[1], RULES, 1_000)).toBeNull();
  });

  it("decides divergence in fixed point, where floats would round across the truncation boundary", () => {
    // (100.13 - 99.87) is exactly 26 bps of the 100 median; a float subtraction truncates to 25.
    const exact = foldQuotes({}, 1, quotes([["a", "99.87", 1_000], ["b", "100.13", 1_000]]), 1_000);
    expect(indexOf(exact[1], { ...RULES, max_divergence_bps: 25 }, 1_000)).toBeNull();
    const inside = foldQuotes({}, 1, quotes([["a", "99.875", 1_000], ["b", "100.125", 1_000]]), 1_000);
    expect(indexOf(inside[1], { ...RULES, max_divergence_bps: 25 }, 1_000)).toBe(100);
  });

  it("ignores malformed quotes and counts a quote stamped ahead at the command's time", () => {
    const book = foldQuotes({}, 1, quotes([["a", "100", 2_000], ["b", "0", 1_000], ["c", "not-a-price", 1_000], ["d", "100.1", 1_000], ["e", "100", -5]]), 1_000);
    expect(indexOf(book[1], RULES, 1_000)).toBe(100.05);
    expect(indexOf(book[2], RULES, 1_000)).toBeNull();
  });
});

describe("foldQuotes", () => {
  it("replaces a source's quote, stamps a quote from ahead at the command's time, and keeps the rest of the book", () => {
    let book: QuoteBook = foldQuotes({}, 1, quotes([["a", "100", 900], ["b", "101", 800]]), 1_000);
    book = foldQuotes(book, 2, quotes([["x", "50", 700]]), 1_000);
    book = foldQuotes(book, 1, quotes([["a", "100.5", 1_200]]), 1_000);
    expect(book[1]).toEqual({ a: { mid: fixedFromWire("100.5"), ts: 1_000 }, b: { mid: fixedFromWire("101"), ts: 800 } });
    expect(book[2]).toEqual({ x: { mid: fixedFromWire("50"), ts: 700 } });
  });

  it("keeps the newer quote when an older one arrives, drops a quote stamped too far ahead, and drops malformed quotes", () => {
    let book: QuoteBook = foldQuotes({}, 1, quotes([["a", "100", 1_000]]), 1_000);
    book = foldQuotes(book, 1, quotes([["a", "99", 900]]), 1_100); // stamped before the held quote: refused
    book = foldQuotes(book, 1, quotes([["b", "50", 3_000]]), 1_100); // 1 900 ms ahead of the command: refused
    book = foldQuotes(book, 1, quotes([["c", "0", 1_100], ["d", "not-a-price", 1_100], ["e", "100", -5]]), 1_100); // malformed: refused
    book = foldQuotes(book, 1, quotes([["f", "100.1", 1_050]]), 1_100); // 50 ms ahead: kept, stamped at the command
    expect(book[1]).toEqual({ a: { mid: fixedFromWire("100"), ts: 1_000 }, f: { mid: fixedFromWire("100.1"), ts: 1_050 } });
  });

  it("drops a mid above the engine's maximum input, and keeps one exactly at it", () => {
    let book: QuoteBook = foldQuotes({}, 1, quotes([["a", "1000000001", 1_000]]), 1_000);
    expect(book[1]).toEqual({});
    book = foldQuotes(book, 1, quotes([["b", "1000000000", 1_000], ["c", "0.000000001", 1_000]]), 1_000);
    expect(book[1]).toEqual({ b: { mid: fixedFromWire("1000000000"), ts: 1_000 }, c: { mid: fixedFromWire("0.000000001"), ts: 1_000 } });
  });

  it("refuses a contract-tagged quote for a spot market, which the engine does not take", () => {
    const tagged = quotes([["a", "100", 1_000], ["b", "100.1", 1_000]]);
    const second = tagged[1];
    if (second === undefined) throw new Error("no second quote");
    const book = foldQuotes({}, 1, [...tagged.slice(0, 1), { ...second, contract: "ESZ6" }], 1_000);
    expect(book[1]).toEqual({ a: { mid: fixedFromWire("100"), ts: 1_000 } });
    expect(indexOf(book[1], RULES, 1_000)).toBeNull(); // one fresh source of the two the market names
  });
});
