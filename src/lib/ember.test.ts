/** Tests for the temporary ember candidates. */

import { describe, expect, it } from "vitest";

import { DEFAULT_EMBER, EMBER_CANDIDATES, emberFor } from "./ember";

const lum = (hex: string) => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

describe("ember candidates", () => {
  it("keeps text legible on the console backgrounds, and a hover lighter than its base", () => {
    for (const c of EMBER_CANDIDATES) {
      expect(contrast(c.base, "#0a0e0f")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.base, "#0f1517")).toBeGreaterThanOrEqual(4.5);
      expect(lum(c.hover)).toBeGreaterThan(lum(c.base));
    }
  });

  it("falls back to the default for an unknown id", () => {
    expect(emberFor("nope").id).toBe(DEFAULT_EMBER);
    expect(emberFor("h0").base).toBe("#ff74a5");
  });
});
