/** Tests for the engine's roundings over the console's fixed point. */

import { describe, expect, it } from "vitest";

import { parseFixed, type Fixed } from "./fixed";
import { divRounded, mulBpsRounded, mulRounded, mulTenthBpsRounded, roundDiv, roundToPlaces } from "./fixed-rounding";

const f = (text: string): Fixed => {
  const value = parseFixed(text);
  if (value === null) throw new Error(`bad fixture ${text}`);
  return value;
};

describe("roundDiv", () => {
  it("rounds down, up and toward zero on both signs, and leaves an exact quotient", () => {
    expect([roundDiv(7n, 2n, "down"), roundDiv(7n, 2n, "up"), roundDiv(7n, 2n, "toward-zero")]).toEqual([3n, 4n, 3n]);
    expect([roundDiv(-7n, 2n, "down"), roundDiv(-7n, 2n, "up"), roundDiv(-7n, 2n, "toward-zero")]).toEqual([-4n, -3n, -3n]);
    expect([roundDiv(6n, 2n, "up"), roundDiv(-6n, 2n, "down")]).toEqual([3n, -3n]);
    expect(() => roundDiv(1n, 0n, "up")).toThrow("division by zero");
  });
});

describe("the fixed-point roundings", () => {
  it("multiply, divide and take basis points and tenths of a bp, rounded once", () => {
    expect([mulRounded(f("1.5"), f("0.000000001"), "up"), mulRounded(f("1.5"), f("0.000000001"), "down")]).toEqual([2n, 1n]);
    expect([divRounded(f("1"), f("3"), "up"), divRounded(f("-1"), f("3"), "down")]).toEqual([333_333_334n, -333_333_334n]);
    expect([mulBpsRounded(f("1"), 3, "up"), mulTenthBpsRounded(f("1"), 4, "up"), mulTenthBpsRounded(1n, 4, "up")]).toEqual([300_000n, 40_000n, 1n]);
  });
});

describe("roundToPlaces", () => {
  it("rounds a bound shown to the cent or a market's places in its claim's direction", () => {
    expect([roundToPlaces(f("100020.0045"), 2, "up"), roundToPlaces(f("100020.0045"), 2, "down")]).toEqual([f("100020.01"), f("100020")]);
    expect([roundToPlaces(f("-3.879"), 2, "down"), roundToPlaces(f("-3.879"), 2, "up")]).toEqual([f("-3.88"), f("-3.87")]);
    expect(roundToPlaces(f("1.2"), 9, "up")).toBe(f("1.2"));
  });
});
