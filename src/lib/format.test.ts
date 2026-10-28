/** Tests for locale-independent number and hex formatting. */

import { describe, expect, it } from "vitest";

import { formatCents, formatFixed, formatMilli, formatSigned, groupThousands, shortHex, formatMovePercent } from "./format";

describe("format", () => {
  it("formats fixed-point integers without locale", () => {
    expect(formatCents(10_001_240)).toBe("100,012.40");
    expect(formatCents(-3_903)).toBe("-39.03");
    expect(formatCents(5)).toBe("0.05");
    expect(formatMilli(250)).toBe("0.250");
    expect(formatFixed(108_000, 5)).toBe("1.08000");
    expect(formatFixed(1_234_567, 0)).toBe("1,234,567");
  });

  it("shortens long hex and leaves short hex alone", () => {
    expect(shortHex(`0x${"ab".repeat(32)}`)).toBe("0xababab…abab");
    expect(shortHex("0x00a1")).toBe("0x00a1");
  });

  it("signs positive values and leaves zero unsigned", () => {
    expect(formatSigned(1_000, 2)).toBe("+10.00");
    expect(formatSigned(-503, 2)).toBe("-5.03");
    expect(formatSigned(0, 1)).toBe("0.0");
    expect(groupThousands(1_000)).toBe("1,000");
    expect(groupThousands(999)).toBe("999");
  });
});

describe("formatMovePercent", () => {
  it("signs a move in basis points and prints two places", () => {
    expect(formatMovePercent(241)).toBe("+2.41%");
    expect(formatMovePercent(-18)).toBe("−0.18%");
    expect(formatMovePercent(0)).toBe("0.00%");
  });
});
