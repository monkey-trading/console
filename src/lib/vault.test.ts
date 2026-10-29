/** Tests for the vault's limits and the withdrawable amount. */

import { describe, expect, it } from "vitest";

import { fixedFromInt, parseFixed } from "./fixed";
import { isWholeUsdc, withdrawableNow } from "./vault";

describe("withdrawableNow", () => {
  it("is the smaller of unlocked cash and equity above margin, and never negative", () => {
    expect(withdrawableNow(fixedFromInt(1_000), fixedFromInt(1_200), fixedFromInt(300))).toBe(fixedFromInt(900));
    expect(withdrawableNow(fixedFromInt(1_000), fixedFromInt(5_000), fixedFromInt(300), fixedFromInt(400))).toBe(fixedFromInt(600));
    expect(withdrawableNow(fixedFromInt(100), fixedFromInt(50), fixedFromInt(300))).toBe(0n);
  });
});

describe("isWholeUsdc", () => {
  it("accepts six decimal places and refuses finer amounts", () => {
    expect(isWholeUsdc(parseFixed("10.123456") ?? 1n)).toBe(true);
    expect(isWholeUsdc(parseFixed("10.1234567") ?? 0n)).toBe(false);
  });
});
