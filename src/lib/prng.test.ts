/** Tests for the seeded generator behind the simulations. */

import { describe, expect, it } from "vitest";

import { mulberry32, pick, randInt } from "./prng";

describe("mulberry32", () => {
  it("gives the same draws for a seed, in [0, 1)", () => {
    const a = mulberry32(1871);
    const b = mulberry32(1871);
    const draws = Array.from({ length: 1_000 }, () => a());
    expect(Array.from({ length: 1_000 }, () => b())).toEqual(draws);
    expect(draws.every((d) => d >= 0 && d < 1)).toBe(true);
    // Mulberry32's published first draw for seed 0, so a change to the generator fails here.
    expect(mulberry32(0)()).toBe(0.26642920868471265);
  });
});

describe("randInt", () => {
  it("covers both bounds and nothing outside them", () => {
    const rand = mulberry32(7);
    const seen = new Set(Array.from({ length: 2_000 }, () => randInt(rand, 3, 6)));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it("maps the extreme draws to the bounds", () => {
    expect(randInt(() => 0, 3, 6)).toBe(3);
    expect(randInt(() => 0.999_999, 3, 6)).toBe(6);
  });
});

describe("pick", () => {
  it("draws an item of the list", () => {
    expect(pick(() => 0, ["a", "b", "c"])).toBe("a");
    expect(pick(() => 0.999_999, ["a", "b", "c"])).toBe("c");
  });

  it("throws on an empty list", () => {
    expect(() => pick(() => 0.5, [])).toThrow("pick: no items to choose from");
  });
});
