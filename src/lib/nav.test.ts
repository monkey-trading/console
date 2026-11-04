import { describe, expect, it } from "vitest";

import { isCurrentPage, PAGES } from "./nav";

describe("isCurrentPage", () => {
  it("lists MONKEY after House, Staking after MONKEY, then Funding, and Settings last", () => {
    expect(PAGES.map((p) => p.label)).toEqual(["Trade", "House", "MONKEY", "Staking", "Funding", "Settings"]);
  });

  it("marks the page whose path matches, and only that one", () => {
    expect(PAGES.filter((p) => isCurrentPage("/", p.href)).map((p) => p.label)).toEqual(["Trade"]);
    expect(PAGES.filter((p) => isCurrentPage("/house", p.href)).map((p) => p.label)).toEqual(["House"]);
    expect(PAGES.filter((p) => isCurrentPage("/monkey", p.href)).map((p) => p.label)).toEqual(["MONKEY"]);
    expect(PAGES.filter((p) => isCurrentPage("/staking", p.href)).map((p) => p.label)).toEqual(["Staking"]);
    expect(PAGES.filter((p) => isCurrentPage("/funding", p.href)).map((p) => p.label)).toEqual(["Funding"]);
    expect(PAGES.filter((p) => isCurrentPage("/settings", p.href)).map((p) => p.label)).toEqual(["Settings"]);
  });

  it("ignores a trailing slash", () => {
    expect(isCurrentPage("/house/", "/house")).toBe(true);
    expect(isCurrentPage("//", "/")).toBe(true);
  });

  it("marks nothing for a path that is not a page, or no path", () => {
    expect(isCurrentPage("/notices", "/")).toBe(false);
    expect(isCurrentPage("/house/extra", "/house")).toBe(false);
    expect(isCurrentPage(null, "/")).toBe(false);
  });
});
