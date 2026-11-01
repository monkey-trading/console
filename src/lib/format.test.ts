/** Tests for locale-independent number and hex formatting. */

import { describe, expect, it } from "vitest";

import { formatMonkey, formatMovePercent, formatRate, groupThousands, MONKEY_UNIT, shortHex } from "./format";

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

describe("formatMonkey", () => {
  it("formats base units as grouped whole MONKEY with two truncated places and no trailing zeros", () => {
    expect(formatMonkey(0n)).toBe("0 MONKEY");
    expect(formatMonkey(MONKEY_UNIT)).toBe("1 MONKEY");
    expect(formatMonkey(1500n * MONKEY_UNIT / 1000n)).toBe("1.5 MONKEY");
    expect(formatMonkey(2_000n * MONKEY_UNIT)).toBe("2,000 MONKEY");
    expect(formatMonkey(1_234n * MONKEY_UNIT + 567_890n * MONKEY_UNIT / 1_000_000n)).toBe("1,234.56 MONKEY");
    // The third place is truncated, never rounded, as the engine's fixed point truncates.
    expect(formatMonkey(1_009n * MONKEY_UNIT / 1_000n)).toBe("1 MONKEY");
  });
});

describe("formatRate", () => {
  it("prints a rate in basis points as an unsigned percentage with two places", () => {
    expect(formatRate(1000)).toBe("10.00%");
    expect(formatRate(25)).toBe("0.25%");
    expect(formatRate(0)).toBe("0.00%");
  });
});
