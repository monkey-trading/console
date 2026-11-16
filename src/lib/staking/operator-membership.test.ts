/** Tests for the operator table's rotation set columns (monkey-trading/console#280): each row's place in the set in effect. */

import { describe, expect, it } from "vitest";

import { membershipWord, withMembership } from "./operator-membership";
import type { OperatorRow } from "./operator-table";
import type { RotationSet } from "./rotation";

const row = (address: string): OperatorRow => ({
  address, hostname: null, registeredHostname: "", role: "candidate", listed: true, eligible: true, votes: 0n, shareBps: 0, bond: 0n, release: "0x", endpoint: null, registration: 0, membership: null,
});
const SET: RotationSet = { set: 3, epoch: 41, effectiveAtMs: 0, members: [{ address: "0xa", adminKey: "0xa", weight: 30n, turnShareBps: 7_500 }, { address: "0xb", adminKey: "0xb", weight: 10n, turnShareBps: 2_500 }], totalWeight: 40n };

describe("withMembership", () => {
  it("gives a member its weight and share, and a row outside the set none", () => {
    expect(withMembership([row("0xa"), row("0xc")], SET).map((r) => r.membership)).toEqual([{ inSet: true, weight: 30n, turnShareBps: 7_500 }, { inSet: false, weight: 0n, turnShareBps: 0 }]);
  });

  it("knows no row's place while no set is known", () => {
    expect(withMembership([{ ...row("0xa"), membership: { inSet: true, weight: 1n, turnShareBps: 1 } }], null).map((r) => r.membership)).toEqual([null]);
  });
});

describe("membershipWord", () => {
  it("says Member, Outside the set, or a dash while no set is known", () => {
    expect([membershipWord({ inSet: true, weight: 1n, turnShareBps: 1 }), membershipWord({ inSet: false, weight: 0n, turnShareBps: 0 }), membershipWord(null)]).toEqual(["Member", "Outside the set", "—"]);
  });
});
