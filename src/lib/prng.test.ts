/** Tests for the seeded generator behind the simulations. */

import { describe, expect, it } from "vitest";

import { mulberry32 } from "./prng";

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
