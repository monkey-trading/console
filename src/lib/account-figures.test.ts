/** Tests for the account figures the Funding page shows: the node's requirement and withdrawable cash from V64, the console's own sums before it. */

import { describe, expect, it } from "vitest";

import { freeCash, requirementOf, withdrawableOf, withdrawCause } from "./account-figures";
import { fixedFromInt } from "./fixed";

const base = { balance: fixedFromInt(10_000), unfinalised: 0n, equity: fixedFromInt(10_000), margin: fixedFromInt(1_000) };
const withRequirements = { ...base, requirements: { initialMargin: fixedFromInt(2_500), maintenanceMargin: fixedFromInt(500), withdrawable: fixedFromInt(7_400), maxLeverage: new Map() } };

describe("before V64", () => {
  it("takes the margin as the requirement, and withdrawable cash as the smaller of the unlocked cash and the equity above margin", () => {
    expect(requirementOf(base)).toBe(fixedFromInt(1_000));
    expect(freeCash(base)).toBe(fixedFromInt(9_000));
    expect(withdrawableOf(base)).toBe(fixedFromInt(9_000));
    expect(withdrawableOf({ ...base, unfinalised: fixedFromInt(2_000) })).toBe(fixedFromInt(8_000));
  });
});

describe("from V64", () => {
  it("takes the node's initial requirement for what is free and its own figure for what may be withdrawn", () => {
    expect(requirementOf(withRequirements)).toBe(fixedFromInt(2_500));
    expect(freeCash(withRequirements)).toBe(fixedFromInt(7_500));
    expect(withdrawableOf(withRequirements)).toBe(fixedFromInt(7_400));
  });

  it("shows no free cash for an account below its requirement", () => {
    expect(freeCash({ ...withRequirements, equity: fixedFromInt(2_000) })).toBe(0n);
  });

  it("names the requirement as what holds a withdrawal below the balance while positions use margin at the tier's floor", () => {
    expect(withdrawCause(withRequirements)).toBe("margin");
    expect(withdrawCause({ ...withRequirements, requirements: { ...withRequirements.requirements, initialMargin: 0n }, margin: 0n })).toBeNull();
    expect(withdrawCause({ ...withRequirements, unfinalised: fixedFromInt(9_000) })).toBe("unfinal");
  });
});
