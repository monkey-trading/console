import { describe, expect, it } from "vitest";

import { currentMark, isCurrentPage, isCurrentTab, PAGES, readsFor, SECTIONS } from "./nav";

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

describe("currentMark", () => {
  it("marks the page on the exact match", () => {
    expect(currentMark("/staking", "/staking")).toBe("page");
    expect(currentMark("/staking/", "/staking")).toBe("page");
    expect(currentMark("/", "/")).toBe("page");
  });

  it("marks the section link true on one of its sub-routes, not page", () => {
    expect(currentMark("/staking/rewards", "/staking")).toBe("true");
    expect(currentMark("/staking/epochs/", "/staking")).toBe("true");
    expect(currentMark("/house/risk", "/house")).toBe("true");
  });

  it("marks nothing on another page's route, a path that merely starts with the href, or no path", () => {
    expect(currentMark("/monkey", "/staking")).toBeUndefined();
    expect(currentMark("/stakingholder", "/staking")).toBeUndefined();
    expect(currentMark("/notices", "/")).toBeUndefined();
    expect(currentMark(null, "/staking")).toBeUndefined();
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

describe("readsFor", () => {
  it("starts the panel's reads on every tab, the operators' on Delegate and Epochs, the delegations' on Delegate, the epochs' on Rewards and Epochs, and the history's on Rewards", () => {
    expect(readsFor("/staking")).toEqual(["panel", "operators", "delegations"]);
    expect(readsFor("/staking/rewards")).toEqual(["panel", "epochs", "history"]);
    expect(readsFor("/staking/epochs")).toEqual(["panel", "operators", "epochs"]);
  });

  it("records a table for every tab the section lists", () => {
    for (const tab of SECTIONS["/staking"].tabs) expect(readsFor(tab.href).length).toBeGreaterThan(0);
  });

  it("throws for a path that is not one of the section's tabs", () => {
    expect(() => readsFor("/stakingholder")).toThrow("no reads recorded for the section tab /stakingholder");
  });
});
