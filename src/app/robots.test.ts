/** Test of the `robots.txt` rules: every crawler is disallowed from every path. */

import { describe, expect, it } from "vitest";

import robots from "./robots";

describe("robots", () => {
  it("disallows every path for every crawler and exempts none", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});
