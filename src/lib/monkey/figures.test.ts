import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { MONKEY_UNIT } from "../format";
import { compactNumber, monkeyExact, failed, formatAgo, formatDuration, halvingsBetween, latestText, monkeyInputText, parseMonkeyAmount, plotValue, shareBps } from "./figures";

describe("shareBps", () => {
  it("truncates a share to basis points and never passes 100%", () => {
    expect(shareBps(1n, 3n)).toBe(3_333);
    expect(shareBps(5n, 3n)).toBe(10_000);
  });
  it("is zero for nothing staked or no total", () => {
    expect(shareBps(0n, 10n)).toBe(0);
    expect(shareBps(4n, 0n)).toBe(0);
  });
});

describe("parseMonkeyAmount", () => {
  it("reads whole and fractional MONKEY into base units with up to eighteen places", () => {
    expect(parseMonkeyAmount("1")).toBe(10n ** 18n);
    expect(parseMonkeyAmount(" 0.5 ")).toBe(5n * 10n ** 17n);
    expect(parseMonkeyAmount("0.000000000000000001")).toBe(1n);
  });
  it("refuses zero, signs, exponents, separators and a nineteenth place", () => {
    for (const text of ["", "0", "0.0", "-1", "+1", "1e3", "1,000", "1.", ".5", "0.0000000000000000001", "abc"]) expect(parseMonkeyAmount(text), text).toBeNull();
  });
  it("round-trips through the field text", () => {
    expect(monkeyInputText(1_234_500_000_000_000_000n)).toBe("1.2345");
    expect(parseMonkeyAmount(monkeyInputText(7n))).toBe(7n);
    expect(monkeyInputText(3n * 10n ** 18n)).toBe("3");
  });
});

describe("monkeyExact", () => {
  it("shows every place a transaction moves, never rounded to nothing, with the whole part grouped", () => {
    expect(monkeyExact(5n * 10n ** 15n)).toBe("0.005 MONKEY");
    expect(monkeyExact(1_999n * 10n ** 15n)).toBe("1.999 MONKEY");
    expect(monkeyExact(1_234_567n * MONKEY_UNIT)).toBe("1,234,567 MONKEY");
    expect(monkeyExact(1n)).toBe("0.000000000000000001 MONKEY");
  });
});

describe("durations", () => {
  it("shows the two largest units", () => {
    expect(formatDuration(2 * 86_400_000 + 4 * 3_600_000 + 5)).toBe("2d 4h");
    expect(formatDuration(3 * 3_600_000 + 12 * 60_000)).toBe("3h 12m");
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration(59_000)).toBe("under a minute");
    expect(formatDuration(-5)).toBe("under a minute");
  });
  it("says how long ago", () => {
    expect(formatAgo(1_000, 30_000)).toBe("just now");
    expect(formatAgo(0, 4 * 60_000)).toBe("4m ago");
  });
});

describe("halvingsBetween", () => {
  const schedule = { start_ms: 1_000, period_ms: 10, halving_periods: 100 };
  it("lists the halvings inside a window, never period 0's start", () => {
    expect(halvingsBetween(schedule, 0, 3_500)).toEqual([2_000, 3_000]);
    expect(halvingsBetween(schedule, 2_001, 2_999)).toEqual([]);
  });
  it("includes both ends and tolerates a schedule with no span", () => {
    expect(halvingsBetween(schedule, 2_000, 3_000)).toEqual([2_000, 3_000]);
    expect(halvingsBetween({ ...schedule, halving_periods: 0 }, 0, 9_999)).toEqual([]);
  });
});

describe("plotValue and latestText", () => {
  it("scales each unit to the number its axis plots", () => {
    expect(plotValue("2500000000000000000", "monkey_base_units")).toBe(2.5);
    expect(plotValue("1234567", "usdc_base_units")).toBe(1.234567);
    // 10.5 MONKEY per dollar, written as base units per dollar with a fraction.
    expect(plotValue("10500000000000000000.25", "monkey_base_units_per_usd")).toBe(10.5);
  });
  it("refuses a value or unit it does not know", () => {
    expect(plotValue("12x", "monkey_base_units")).toBeNull();
    expect(plotValue("1", "furlongs")).toBeNull();
  });
  it("writes the latest value in its unit's words", () => {
    expect(latestText("usdc_base_units", "1007000000")).toBe("1,007 USDC");
    expect(latestText("monkey_base_units", "2072000000000000000000000")).toBe("2,072,000 MONKEY");
    expect(latestText("monkey_base_units_per_usd", "10100000000000000000.5")).toBe("10.1 MONKEY per $1");
    expect(latestText("usdc_base_units", null)).toBe("—");
    expect(latestText("monkey_base_units", "1.5")).toBe("—");
  });
  it("formats axis labels compactly", () => {
    expect(compactNumber(9_140_000_000)).toBe("9.14B");
    expect(compactNumber(2_070_000)).toBe("2.07M");
    expect(compactNumber(1_500)).toBe("1.5K");
    expect(compactNumber(5.056)).toBe("5.06");
  });
});

describe("failed", () => {
  it("calls a 404 unavailable and drops what was held", () => {
    expect(failed(new EngineError(404, "not found"), 5)).toEqual({ status: "unavailable", value: null, message: null });
  });
  it("keeps the last answer through another failure", () => {
    expect(failed(new EngineError(500, "boom"), 5)).toEqual({ status: "failed", value: 5, message: "boom" });
    expect(failed("odd", null).message).toBe("The read failed.");
  });
});
