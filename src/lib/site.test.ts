/** Tests for the canonical origin read from the build environment. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { siteUrl } from "./site";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Sets the two variables `siteUrl()` reads; `undefined` leaves one unset. */
function env(site: string | undefined, vercel: string | undefined) {
  vi.stubEnv("SITE_URL", site);
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", vercel);
}

describe("siteUrl", () => {
  it("prefers SITE_URL, then the Vercel production domain, then local development", () => {
    env("https://monkey.example", "monkey.vercel.app");
    expect(siteUrl()).toBe("https://monkey.example");
    env(undefined, "monkey.vercel.app");
    expect(siteUrl()).toBe("https://monkey.vercel.app");
    env(undefined, undefined);
    expect(siteUrl()).toBe("http://localhost:3000");
  });

  it("returns the origin without a trailing slash or a default port", () => {
    env("https://monkey.example/", undefined);
    expect(siteUrl()).toBe("https://monkey.example");
    env("https://monkey.example:443", undefined);
    expect(siteUrl()).toBe("https://monkey.example");
    env("http://localhost:4000", undefined);
    expect(siteUrl()).toBe("http://localhost:4000");
  });

  it.each([
    ["a path", "https://monkey.example/app"],
    ["a query", "https://monkey.example/?campaign=x"],
    ["an empty query", "https://monkey.example/?"],
    ["a fragment", "https://monkey.example/#top"],
    ["credentials", "https://user:pass@monkey.example"],
    ["another scheme", "ftp://monkey.example"],
  ])("fails the build on a SITE_URL with %s", (_, value) => {
    env(value, undefined);
    expect(() => siteUrl()).toThrow(`SITE_URL must be a bare http(s) origin, such as https://example.com: ${value}`);
  });

  it("fails the build on a value that is not a URL, from either variable", () => {
    env("monkey.example", undefined);
    expect(() => siteUrl()).toThrow("SITE_URL is not a URL: monkey.example");
    env(undefined, "monkey vercel.app");
    expect(() => siteUrl()).toThrow("VERCEL_PROJECT_PRODUCTION_URL is not a URL: https://monkey vercel.app");
  });

  it("fails the build on a Vercel domain that carries a path", () => {
    env(undefined, "monkey.vercel.app/preview");
    expect(() => siteUrl()).toThrow("VERCEL_PROJECT_PRODUCTION_URL must be a bare http(s) origin");
  });
});
