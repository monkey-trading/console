/** Tests for price text. */

import { describe, expect, it } from "vitest";

import { formatPrice, splitDecimals } from "./price-format";

describe("formatPrice", () => {
  it("groups the whole part and fixes the places", () => {
    expect(formatPrice(67420.5, 2)).toBe("67,420.50");
    expect(formatPrice(1.0824, 5)).toBe("1.08240");
    expect(formatPrice(-5.5, 1)).toBe("-5.5");
    expect(splitDecimals("67,420.50")).toEqual(["67,420", ".50"]);
    expect(splitDecimals("5")).toEqual(["5", ""]);
  });
});
