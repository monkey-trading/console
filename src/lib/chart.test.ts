/** Tests for the chart's scale and price text. */

import { describe, expect, it } from "vitest";

import { formatPrice, PLOT, scaleFor, splitDecimals } from "./chart";

const candle = (low: number, high: number) => ({ t: 0, open: low, close: high, low, high });

describe("scaleFor", () => {
  it("maps higher prices higher on the plot and keeps every wick inside it", () => {
    const scale = scaleFor([candle(100, 110), candle(95, 105)]);
    expect(scale.y(110)).toBeLessThan(scale.y(95));
    expect(scale.y(110)).toBeGreaterThan(PLOT.top);
    expect(scale.y(95)).toBeLessThan(PLOT.bottom);
  });

  it("includes extra levels such as the bid and the ask", () => {
    const scale = scaleFor([candle(100, 101)], [120]);
    expect(scale.max).toBeGreaterThan(120);
  });
});

describe("formatPrice", () => {
  it("groups the whole part and fixes the places", () => {
    expect(formatPrice(67420.5, 2)).toBe("67,420.50");
    expect(formatPrice(1.0824, 5)).toBe("1.08240");
    expect(splitDecimals("67,420.50")).toEqual(["67,420", ".50"]);
    expect(splitDecimals("5")).toEqual(["5", ""]);
  });
});
