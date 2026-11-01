/** Tests for the Deposit tab's steps. */

import { describe, expect, it } from "vitest";

import { depositSteps } from "./deposit-steps";

describe("depositSteps", () => {
  it("deposits and then declares on a live node, whose engine takes a first declaration once a deposit is pending", () => {
    expect(depositSteps("checked", false)).toEqual(["deposit", "eligibility"]);
  });

  it("declares and then deposits on the mock", () => {
    expect(depositSteps("none", false)).toEqual(["eligibility", "deposit"]);
  });

  it("shows no eligibility step once a declaration is recorded, in either build", () => {
    expect(depositSteps("checked", true)).toEqual(["deposit"]);
    expect(depositSteps("none", true)).toEqual(["deposit"]);
  });
});
