import { describe, expect, it } from "vitest";

import { formatCompactUsd, formatUsdc, minimumSpanRange, parseUnits } from "./chart-format";

describe("formatCompactUsd", () => {
  it.each([[61_936_727.53, "$61.9M"], [-3_250, "-$3.25K"], [850, "$850"], [4.5, "$4.50"], [0, "$0.00"], [1.2e9, "$1.20B"], [-0.2, "-$0.20"], [-0.004, "$0.00"], [123_456, "$123K"], [999_600, "$1.00M"], [999.6, "$1.00K"], [999_400, "$999K"], [-999_600_000, "-$1.00B"]])("writes %s as %s", (value, text) => {
    expect(formatCompactUsd(value)).toBe(text);
  });
});

describe("USDC base units", () => {
  it("formats six-decimal units to cents, grouped", () => {
    expect(formatUsdc(1_842_500_000n)).toBe("1,842.50 USDC");
    expect(formatUsdc(999n)).toBe("0.00 USDC");
  });

  it("parses whole base units only", () => {
    expect(parseUnits("500")).toBe(500n);
    for (const bad of ["", "-1", "1.5", "0x10", "1e3"]) expect(parseUnits(bad)).toBeNull();
  });
});

describe("minimumSpanRange", () => {
  it("centres a flat series on its value with a span of 4% of it, wide enough for ticks to print distinct labels", () => {
    expect(minimumSpanRange(99_900, 99_900)).toEqual({ min: 97_902, max: 101_898 });
    const range = minimumSpanRange(99_900, 99_900);
    const ticks = [0, 1, 2, 3, 4].map((i) => formatCompactUsd((range?.min ?? 0) + (i * ((range?.max ?? 0) - (range?.min ?? 0))) / 4));
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it("widens an almost flat series the same way and leaves one that already spans enough to the chart", () => {
    expect(minimumSpanRange(99_900, 99_950)).toEqual({ min: 97_926.5, max: 101_923.5 });
    expect(minimumSpanRange(90_000, 99_900)).toBeNull();
  });

  it("gives a series flat at zero a span of one", () => {
    expect(minimumSpanRange(0, 0)).toEqual({ min: -0.5, max: 0.5 });
  });
});
