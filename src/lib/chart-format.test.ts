import { describe, expect, it } from "vitest";

import { formatCompactUsd, formatUsdc, parseUnits } from "./chart-format";

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
