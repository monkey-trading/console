/** Tests of the geo-block rule table: which country header values the rewrite matches. */

import { describe, expect, it } from "vitest";

import { BLOCKED_SOURCE, COUNTRY_HEADER, RESTRICTED_COUNTRIES, geoBlockRewrites, restrictedCountryPattern } from "./geo-block";

/** Whether the rewrite rules send a request with this country header value (or none) to the restricted page. */
function isBlocked(countries: readonly string[], country: string | undefined): boolean {
  return geoBlockRewrites(countries).some((rule) =>
    rule.has.every((condition) => {
      if (country === undefined) return false;
      // Next.js anchors a `has` value as a regular expression over the whole header value.
      return condition.key === COUNTRY_HEADER && new RegExp(`^${condition.value}$`).test(country);
    }),
  );
}

describe("geoBlockRewrites", () => {
  it("rewrites a request from a listed country to the restricted page", () => {
    expect(geoBlockRewrites(["US", "KP"])).toEqual([
      {
        source: BLOCKED_SOURCE,
        has: [{ type: "header", key: "x-vercel-ip-country", value: "(?:US|KP)" }],
        destination: "/restricted",
      },
    ]);
    expect(isBlocked(["US", "KP"], "US")).toBe(true);
    expect(isBlocked(["US", "KP"], "KP")).toBe(true);
  });

  it("serves a request from an unlisted country, including one that merely contains a listed code", () => {
    expect(isBlocked(["US", "KP"], "GB")).toBe(false);
    expect(isBlocked(["US", "KP"], "USA")).toBe(false);
    expect(isBlocked(["US", "KP"], "XUS")).toBe(false);
    expect(isBlocked(["US", "KP"], "us")).toBe(false);
  });

  it("serves a request whose country is unknown", () => {
    expect(isBlocked(["US", "KP"], undefined)).toBe(false);
    expect(isBlocked(["US", "KP"], "")).toBe(false);
  });

  it("blocks nothing for an empty list", () => {
    expect(geoBlockRewrites([])).toEqual([]);
  });

  it("blocks the US and each of its territories, and not a neighbour", () => {
    for (const code of ["US", "PR", "GU", "VI", "AS", "MP", "UM"]) expect(isBlocked(RESTRICTED_COUNTRIES, code)).toBe(true);
    expect(["GB", "CA", "MX", "CU"].map((code) => isBlocked(RESTRICTED_COUNTRIES, code))).toEqual([false, false, false, false]);
  });
});

describe("BLOCKED_SOURCE", () => {
  it("skips the build assets, the restricted page and robots.txt, and covers every other path", () => {
    // The Next.js path matcher compiles this source; it is a lookahead over the path after `/`.
    const matcher = new RegExp(`^${BLOCKED_SOURCE}$`);
    expect(["/", "/trade", "/a/b", "/restricted/x", "/_nextx", "/icon.png"].map((path) => matcher.test(path))).toEqual([
      true, true, true, true, true, true,
    ]);
    expect(["/_next/static/css/a.css", "/restricted", "/robots.txt"].map((path) => matcher.test(path))).toEqual([false, false, false]);
    expect(["/robots.txt/x", "/robotsxtxt"].map((path) => matcher.test(path))).toEqual([true, true]);
  });
});

describe("restrictedCountryPattern", () => {
  it("rejects a code that is not two uppercase letters", () => {
    expect(() => restrictedCountryPattern(["us"])).toThrow("two uppercase letters: us");
    expect(() => restrictedCountryPattern(["USA"])).toThrow("two uppercase letters: USA");
    expect(() => restrictedCountryPattern(["U|"])).toThrow("two uppercase letters: U|");
  });
});
