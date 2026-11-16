/** Tests for the Dashboard page's decisions: the section a #hash load scrolls to, and the line the House figures are held or caveated with, as on the House page. */

import { describe, expect, it } from "vitest";

import { houseGateLine, isPlainClick, overviewProblem, SECTION_IDS, sectionOfHash } from "./dashboard-page";

describe("sectionOfHash", () => {
  it("names the section a #hash load targets", () => {
    expect(sectionOfHash("#house")).toBe("house");
    expect(sectionOfHash("#monkey")).toBe("monkey");
    expect(sectionOfHash("#staking")).toBe("staking");
  });

  it("names nothing for an empty, bare or foreign hash", () => {
    expect(sectionOfHash("")).toBeNull();
    expect(sectionOfHash("#")).toBeNull();
    expect(sectionOfHash("#funding")).toBeNull();
    expect(sectionOfHash("#house-extra")).toBeNull();
    expect(SECTION_IDS).toEqual(["house", "monkey", "staking"]);
  });
});

describe("houseGateLine", () => {
  it("says the first signed answers are being read on a live build, instead of showing NAV $0", () => {
    expect(houseGateLine({ trusted: true, ready: false, fresh: false, simulated: false })).toBe("Loading figures…");
  });

  it("names the simulated node on the mock build", () => {
    expect(houseGateLine({ trusted: true, ready: false, fresh: true, simulated: true })).toBe("Loading the demo figures…");
  });

  it("says the figures may be behind after a refresh has failed", () => {
    expect(houseGateLine({ trusted: true, ready: true, fresh: false, simulated: false })).toBe("The figures have stopped updating, so they may be out of date.");
  });

  it("holds nothing once the figures are ready and fresh, and never overrides the not-trusted line", () => {
    expect(houseGateLine({ trusted: true, ready: true, fresh: true, simulated: false })).toBeNull();
    expect(houseGateLine({ trusted: false, ready: false, fresh: false, simulated: false })).toBeNull();
  });
});

describe("overviewProblem", () => {
  it.each(["the liquidity floor", "the reward schedule"])("qualifies %s for first failures, held failures and unavailable routes", (what) => {
    expect(overviewProblem({ status: "failed", value: null, message: "Timed out." }, what)).toBe(`The page could not load ${what}. Timed out. The page will try again automatically.`);
    expect(overviewProblem({ status: "failed", value: {}, message: null }, what)).toBe(`The page could not refresh ${what}. The information shown may be out of date.`);
    expect(overviewProblem({ status: "unavailable", value: null, message: null }, what)).toBe(`This trading server does not yet provide ${what}.`);
    expect(overviewProblem({ status: "ready", value: {}, message: null }, what)).toBeNull();
    expect(overviewProblem({ status: "loading", value: null, message: null }, what)).toBeNull();
  });
});

describe("isPlainClick", () => {
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it("takes over the primary button with no modifier", () => {
    expect(isPlainClick(plain)).toBe(true);
  });

  it("leaves a click with any modifier, or another button, to the browser", () => {
    for (const other of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }]) expect(isPlainClick({ ...plain, ...other }), JSON.stringify(other)).toBe(false);
  });
});
