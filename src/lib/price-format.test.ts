/** Tests for price text. */

import { describe, expect, it } from "vitest";

import { formatCloseout, formatPrice, splitDecimals } from "./price-format";

describe("formatPrice", () => {
  it("groups the whole part and fixes the places", () => {
    expect(formatPrice(67420.5, 2)).toBe("67,420.50");
    expect(formatPrice(1.0824, 5)).toBe("1.08240");
    expect(formatPrice(-5.5, 1)).toBe("-5.5");
    expect(splitDecimals("67,420.50")).toEqual(["67,420", ".50"]);
    expect(splitDecimals("5")).toEqual(["5", ""]);
  });
});

describe("formatCloseout", () => {
  it("says the price, Due, None, or a dash from a node that does not say", () => {
    expect(formatCloseout({ reach: "at", price: 70_609_510_000_000n }, 2)).toBe("70,609.51");
    expect(formatCloseout({ reach: "due" }, 2)).toBe("Due");
    expect(formatCloseout({ reach: "beyond" }, 2)).toBe("None");
    expect(formatCloseout(null, 2)).toBe("—");
  });
});
