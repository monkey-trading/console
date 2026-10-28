/** Tests for the fixed-point numbers that mirror the engine's. */

import { describe, expect, it } from "vitest";

import {
  absFixed,
  bpsOf,
  divFixed,
  fixedFromInt,
  fixedFromWire,
  fixedToNumber,
  fixedToWire,
  formatFixedPlaces,
  moveBps,
  mulFixed,
  parseFixed,
} from "./fixed";

describe("parseFixed", () => {
  it("reads decimals with up to nine places and a leading minus", () => {
    expect(parseFixed("12.5")).toBe(12_500_000_000n);
    expect(parseFixed("-0.000000001")).toBe(-1n);
    expect(parseFixed(" 7 ")).toBe(7_000_000_000n);
  });

  it.each(["", "abc", "1e3", "+1", "1.", ".5", "1.0000000001", "1,000", "--1", "0x10"])("refuses %j", (text) => {
    expect(parseFixed(text)).toBeNull();
  });
});

describe("fixedToWire", () => {
  it("prints the shortest exact decimal and round-trips", () => {
    expect(fixedToWire(12_500_000_000n)).toBe("12.5");
    expect(fixedToWire(-1n)).toBe("-0.000000001");
    expect(fixedToWire(3_000_000_000n)).toBe("3");
    for (const text of ["0", "1.25", "-67420.123456789"]) expect(fixedToWire(fixedFromWire(text))).toBe(text);
  });

  it("treats a malformed engine decimal as a broken invariant", () => {
    expect(() => fixedFromWire("x")).toThrow("malformed decimal");
  });
});

describe("arithmetic", () => {
  it("truncates toward zero", () => {
    expect(mulFixed(fixedFromInt(3), parseFixed("0.5") ?? 0n)).toBe(parseFixed("1.5"));
    expect(divFixed(fixedFromInt(1), fixedFromInt(3))).toBe(333_333_333n);
    expect(divFixed(fixedFromInt(-1), fixedFromInt(3))).toBe(-333_333_333n);
    expect(bpsOf(fixedFromInt(1_000), 25)).toBe(parseFixed("2.5"));
  });

  it("refuses division by zero", () => {
    expect(() => divFixed(1n, 0n)).toThrow("division by zero");
  });

  it("measures a move in basis points of the start", () => {
    expect(moveBps(fixedFromInt(100), fixedFromInt(101))).toBe(100);
    expect(moveBps(fixedFromInt(100), fixedFromInt(99))).toBe(-100);
    expect(moveBps(0n, fixedFromInt(1))).toBe(0);
  });

  it("converts to a number for layout only", () => {
    expect(fixedToNumber(parseFixed("1.5") ?? 0n)).toBe(1.5);
    expect(absFixed(-5n)).toBe(5n);
  });
});

describe("formatFixedPlaces", () => {
  it("groups, pads, and truncates without a locale", () => {
    expect(formatFixedPlaces(parseFixed("1234567.891") ?? 0n, 2)).toBe("1,234,567.89");
    expect(formatFixedPlaces(parseFixed("5") ?? 0n, 2)).toBe("5.00");
    expect(formatFixedPlaces(parseFixed("-0.004") ?? 0n, 2)).toBe("0.00");
    expect(formatFixedPlaces(parseFixed("-1500") ?? 0n, 0)).toBe("-1,500");
  });
});
