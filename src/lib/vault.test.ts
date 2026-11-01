/** Tests for the vault's limits and the withdrawable amount. */

import { describe, expect, it } from "vitest";

import { fixedFromInt, parseFixed } from "./fixed";
import { formatUsdc, isWholeUsdc, withdrawableNow, withdrawLimitCause } from "./vault";

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

describe("formatUsdc", () => {
  it("shows USDC to its six places without trailing zeros, grouped in thousands", () => {
    expect(formatUsdc(fixedFromInt(1_000))).toBe("1,000 USDC");
    expect(formatUsdc(parseFixed("10.125") ?? 0n)).toBe("10.125 USDC");
    expect(formatUsdc(parseFixed("3.141592") ?? 0n)).toBe("3.141592 USDC");
    expect(formatUsdc(parseFixed("0.5") ?? 0n)).toBe("0.5 USDC");
  });
});

describe("withdrawLimitCause", () => {
  const usd = fixedFromInt;
  it("names a deposit still counting down when its locked cash is what limits the withdrawal", () => {
    expect(withdrawLimitCause(usd(1_000), usd(1_000), 0n, usd(1_000))).toBe("unfinal");
    expect(withdrawLimitCause(usd(1_000), usd(1_000), 0n, usd(400))).toBe("unfinal");
  });

  it("names margin when equity above margin is the smaller of the two", () => {
    expect(withdrawLimitCause(usd(1_000), usd(1_200), usd(900), 0n)).toBe("margin");
    expect(withdrawLimitCause(usd(1_000), usd(1_200), usd(900), usd(50))).toBe("margin");
  });

  it("names neither when the whole balance can go", () => {
    expect(withdrawLimitCause(usd(1_000), usd(1_000), 0n, 0n)).toBeNull();
  });
});
