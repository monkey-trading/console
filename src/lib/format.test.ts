/** Tests for locale-independent number and hex formatting. */

import { describe, expect, it } from "vitest";

import { formatMovePercent, groupThousands, shortHex } from "./format";

describe("format", () => {
  it("shortens long hex and leaves short hex alone", () => {
    expect(shortHex(`0x${"ab".repeat(32)}`)).toBe("0xababab…abab");
    expect(shortHex("0x00a1")).toBe("0x00a1");
  });

  it("groups digits in threes", () => {
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
