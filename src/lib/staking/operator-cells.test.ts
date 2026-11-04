/** Tests for the words of the operator table's cells. */

import { describe, expect, it } from "vitest";

import { MONKEY_UNIT } from "../format";
import { operatorCells, ROLE_LABELS, withAddress } from "./operator-cells";
import type { OperatorRow } from "./operator-table";

const ROW: OperatorRow = {
  address: "0x00000000000000000000000000000000000000a1", hostname: "alpha.example", registeredHostname: "alpha.example", role: "standby", listed: true, eligible: true, registration: 0,
  votes: 620_000n * MONKEY_UNIT, shareBps: 3_712, bond: 50_000n * MONKEY_UNIT, release: `0x${"ab".repeat(32)}`, endpoint: "https://alpha.example:9443/handover",
};

describe("operatorCells", () => {
  it("says a listed candidate's name, role, eligibility, stake with its share, bond, release and endpoint", () => {
    expect(operatorCells(ROW)).toEqual({
      name: "alpha.example", label: "alpha.example", address: "0x000000…00a1", role: "Standby", eligibility: "Eligible",
      delegated: "620,000 MONKEY (37.12%)", bond: "50,000 MONKEY", release: "0xababab…abab", endpoint: "https://alpha.example:9443/handover",
    });
  });

  it("names a hostname the build cannot show, an ineligible candidate, and an empty endpoint plainly, and labels the row by its address", () => {
    expect(operatorCells({ ...ROW, hostname: null, eligible: false, endpoint: "" })).toMatchObject({ name: "Not a plain hostname", label: "0x000000…00a1", eligibility: "Not eligible", endpoint: "—" });
  });

  it("labels every row by its hostname or, with none to show, its own address, never the name cell's placeholder", () => {
    const rows = [ROW, { ...ROW, hostname: null }, { ...ROW, address: "0x00000000000000000000000000000000000000b2", hostname: null }, { ...ROW, hostname: null, role: "active" as const, listed: false, bond: null }];
    expect(rows.map((row) => operatorCells(row).label)).toEqual(["alpha.example", "0x000000…00a1", "0x000000…00b2", "0x000000…00a1"]);
  });

  it("names an operator in effect with no candidacy as the deployment's, with no figures read for it", () => {
    expect(operatorCells({ ...ROW, hostname: null, role: "active", listed: false, eligible: false, votes: null, shareBps: 0, bond: null, endpoint: null })).toMatchObject({
      name: "The deployment's initial operator", label: "0x000000…00a1", role: "Active", eligibility: "Not listed", delegated: "—", bond: "—", endpoint: "—",
    });
  });

  it("labels every role", () => {
    expect(ROLE_LABELS).toEqual({ active: "Active", elected: "Elected", promoted: "Promoted", standby: "Standby", candidate: "Candidate" });
  });
});

describe("withAddress", () => {
  it("names a candidate by hostname and short address, and by the short address alone when that is its label", () => {
    expect(withAddress("alpha.example", ROW.address)).toBe("alpha.example (0x000000…00a1)");
    expect(withAddress("0x000000…00a1", ROW.address)).toBe("0x000000…00a1");
  });
});
