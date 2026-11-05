import { describe, expect, it } from "vitest";

import { isCurrentPage, isCurrentTab, PAGES, SECTIONS } from "./nav";

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

  it("marks a page current on every route of its section", () => {
    expect(isCurrentPage("/staking/rewards", "/staking")).toBe(true);
    expect(isCurrentPage("/staking/epochs/", "/staking")).toBe(true);
    expect(isCurrentPage("/house/risk", "/house")).toBe(true);
  });

  it("marks `/` current only on `/`", () => {
    expect(isCurrentPage("/", "/")).toBe(true);
    expect(isCurrentPage("//", "/")).toBe(true);
    expect(isCurrentPage("/notices", "/")).toBe(false);
  });

  it("ignores a trailing slash", () => {
    expect(isCurrentPage("/house/", "/house")).toBe(true);
  });

  it("marks nothing for a path that is not the page, one of its section's routes, or no path", () => {
    expect(isCurrentPage("/notices", "/house")).toBe(false);
    expect(isCurrentPage("/stakingholder", "/staking")).toBe(false);
    expect(isCurrentPage(null, "/")).toBe(false);
  });
});

describe("isCurrentTab", () => {
  it("marks the tab whose href matches the path exactly", () => {
    const [delegate, rewards] = SECTIONS["/staking"].tabs;
    expect(isCurrentTab("/staking", delegate?.href ?? "")).toBe(true);
    expect(isCurrentTab("/staking/rewards", rewards?.href ?? "")).toBe(true);
  });

  it("ignores a trailing slash on the path", () => {
    expect(isCurrentTab("/staking/", "/staking")).toBe(true);
    expect(isCurrentTab("/staking/rewards/", "/staking/rewards")).toBe(true);
  });

  it("marks a tab current only on its own route, not on the section's or a sibling's", () => {
    expect(isCurrentTab("/staking/rewards", "/staking")).toBe(false);
    expect(isCurrentTab("/staking", "/staking/rewards")).toBe(false);
    expect(isCurrentTab("/staking/epochs", "/staking/rewards")).toBe(false);
    expect(isCurrentTab(null, "/staking")).toBe(false);
  });
});
