/** Tests for the Dashboard page's decisions: the section a #hash load scrolls to, and the line the House figures are held or caveated with, as on the House page. */

import { describe, expect, it } from "vitest";

import { houseGateLine, SECTION_IDS, sectionOfHash } from "./dashboard-page";

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
    expect(houseGateLine({ trusted: true, ready: false, fresh: false, simulated: false })).toBe("Reading the node's first signed answers…");
  });

  it("names the simulated node on the mock build", () => {
    expect(houseGateLine({ trusted: true, ready: false, fresh: true, simulated: true })).toBe("Reading the simulated node's first answers…");
  });

  it("says the figures may be behind after a refresh has failed", () => {
    expect(houseGateLine({ trusted: true, ready: true, fresh: false, simulated: false })).toBe("The node's answers have stopped refreshing, so the figures on this page may be behind.");
  });

  it("holds nothing once the figures are ready and fresh, and never overrides the not-trusted line", () => {
    expect(houseGateLine({ trusted: true, ready: true, fresh: true, simulated: false })).toBeNull();
    expect(houseGateLine({ trusted: false, ready: false, fresh: false, simulated: false })).toBeNull();
  });
});
