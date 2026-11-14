import { describe, expect, it } from "vitest";

import { currentMark, isCurrentPage, isCurrentTab, PAGES, readsFor, SECTIONS } from "./nav";

describe("isCurrentPage", () => {
  it("lists MONKEY after House, Staking after MONKEY, Dashboard after Staking, then Funding, and Settings last", () => {
    expect(PAGES.map((p) => p.label)).toEqual(["Trade", "House", "MONKEY", "Staking", "Dashboard", "Funding", "Settings"]);
  });

  it("marks the page whose path matches, and only that one", () => {
    expect(PAGES.filter((p) => isCurrentPage("/", p.href)).map((p) => p.label)).toEqual(["Trade"]);
    expect(PAGES.filter((p) => isCurrentPage("/house", p.href)).map((p) => p.label)).toEqual(["House"]);
    expect(PAGES.filter((p) => isCurrentPage("/monkey", p.href)).map((p) => p.label)).toEqual(["MONKEY"]);
    expect(PAGES.filter((p) => isCurrentPage("/staking", p.href)).map((p) => p.label)).toEqual(["Staking"]);
    expect(PAGES.filter((p) => isCurrentPage("/dashboard", p.href)).map((p) => p.label)).toEqual(["Dashboard"]);
    expect(PAGES.filter((p) => isCurrentPage("/funding", p.href)).map((p) => p.label)).toEqual(["Funding"]);
    expect(PAGES.filter((p) => isCurrentPage("/settings", p.href)).map((p) => p.label)).toEqual(["Settings"]);
  });

  it("marks a page current on every route of its section", () => {
    expect(isCurrentPage("/staking/rewards", "/staking")).toBe(true);
    expect(isCurrentPage("/staking/epochs/", "/staking")).toBe(true);
    expect(isCurrentPage("/house/risk", "/house")).toBe(true);
    expect(isCurrentPage("/house/withdrawals", "/house")).toBe(true);
    expect(isCurrentPage("/monkey/activity", "/monkey")).toBe(true);
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
    expect(currentMark("/dashboard", "/dashboard")).toBe("page");
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

  it("marks the House and MONKEY section's tabs on their own routes", () => {
    const [overview, risk, withdrawals] = SECTIONS["/house"].tabs;
    const [emissions, activity] = SECTIONS["/monkey"].tabs;
    expect(isCurrentTab("/house", overview?.href ?? "")).toBe(true);
    expect(isCurrentTab("/house/risk", risk?.href ?? "")).toBe(true);
    expect(isCurrentTab("/house/withdrawals", withdrawals?.href ?? "")).toBe(true);
    expect(isCurrentTab("/house/risk", overview?.href ?? "")).toBe(false);
    expect(isCurrentTab("/monkey", emissions?.href ?? "")).toBe(true);
    expect(isCurrentTab("/monkey/activity", activity?.href ?? "")).toBe(true);
    expect(isCurrentTab("/monkey/activity", emissions?.href ?? "")).toBe(false);
  });

  it("lists every section's tabs in the order the bar shows them", () => {
    expect(SECTIONS["/house"].tabs.map((tab) => [tab.href, tab.label])).toEqual([
      ["/house", "Overview"],
      ["/house/risk", "Risk"],
      ["/house/withdrawals", "Withdrawals"],
    ]);
    expect(SECTIONS["/monkey"].tabs.map((tab) => [tab.href, tab.label])).toEqual([
      ["/monkey", "Emissions"],
      ["/monkey/activity", "Activity"],
    ]);
    expect(SECTIONS["/staking"].tabs.map((tab) => [tab.href, tab.label])).toEqual([
      ["/staking", "Delegate"],
      ["/staking/rewards", "Rewards"],
      ["/staking/epochs", "Epochs"],
      ["/staking/governance", "Governance"],
    ]);
  });

  it("marks the Governance tab on its own route, and the top bar's Staking link there", () => {
    expect(isCurrentTab("/staking/governance", "/staking/governance")).toBe(true);
    expect(isCurrentTab("/staking/governance", "/staking")).toBe(false);
    expect(currentMark("/staking/governance", "/staking")).toBe("true");
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
  it("starts the panel's reads on Delegate, Rewards and Epochs, the operators' on Delegate, Epochs and Governance, the delegations' on Delegate and Governance, the epochs' on Rewards and Epochs, the history's on Rewards, and the votes' on Governance", () => {
    expect(readsFor("/staking")).toEqual(["panel", "operators", "delegations"]);
    expect(readsFor("/staking/rewards")).toEqual(["panel", "epochs", "history"]);
    expect(readsFor("/staking/epochs")).toEqual(["panel", "operators", "epochs"]);
    expect(readsFor("/staking/governance")).toEqual(["operators", "delegations", "governance", "votes"]);
  });

  it("records a table for every tab the section lists", () => {
    for (const tab of SECTIONS["/staking"].tabs) expect(readsFor(tab.href).length).toBeGreaterThan(0);
  });

  it("throws for a path that is not one of the section's tabs", () => {
    expect(() => readsFor("/stakingholder")).toThrow("no reads recorded for the section tab /stakingholder");
  });
});
