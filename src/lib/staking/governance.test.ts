import { describe, expect, it } from "vitest";

import type { GovernanceWire, OpenProposalWire, OpenProposalsWire } from "../engine/governance-types";
import { governanceView, NO_GOVERNANCE, passes, proposalsView, weightToPass, yesShareBps } from "./governance";

const VOTE = "0x00000000000000000000000000000000000000A1";
const PROPOSER = "0x00000000000000000000000000000000000000B2";
const HASH = `0x${"Ab".repeat(32)}`;

function open(id: number, over: Partial<OpenProposalWire> = {}): OpenProposalWire {
  return {
    id, proposer: PROPOSER, set_id: 1, fast: false, opens_at_ms: 1_000, closes_at_ms: 2_000, total_weight: "900", yes_weight: "400",
    command_hash: HASH, command: { action: "set_stress_floor", market: null, level: 2 }, ...over,
  };
}

const wire = (proposals: OpenProposalWire[], over: Partial<OpenProposalsWire> = {}): OpenProposalsWire => ({ vote: VOTE, open: proposals, truncated: false, ...over });

describe("proposalsView", () => {
  it("reads each open proposal with its weights as bigints and its addresses lowercase, newest first as the node lists them", () => {
    expect(proposalsView(wire([open(4), open(3, { fast: true, command: null })]))).toEqual({
      vote: VOTE.toLowerCase(), truncated: false, unavailable: false,
      open: [
        { id: 4, proposer: PROPOSER.toLowerCase(), setId: 1, fast: false, opensAtMs: 1_000, closesAtMs: 2_000, tally: { yes: 400n, total: 900n }, commandHash: HASH.toLowerCase(), command: { action: "set_stress_floor", market: null, level: 2 } },
        { id: 3, proposer: PROPOSER.toLowerCase(), setId: 1, fast: true, opensAtMs: 1_000, closesAtMs: 2_000, tally: { yes: 400n, total: 900n }, commandHash: HASH.toLowerCase(), command: null },
      ],
    });
  });

  it("carries the node's word that its read was cut short or failed", () => {
    expect(proposalsView(wire([], { truncated: true }))).toMatchObject({ truncated: true, unavailable: false });
    expect(proposalsView(wire([], { unavailable: true }))).toMatchObject({ open: [], unavailable: true });
  });

  it("refuses a malformed weight, time, address, hash or command", () => {
    const bad: Partial<OpenProposalWire>[] = [
      { yes_weight: "4e2" }, { total_weight: "-1" }, { closes_at_ms: 1_000 }, { opens_at_ms: -1 }, { set_id: 1.5 }, { proposer: "0x12" },
      { command_hash: "0xab" }, { command: { level: 2 } as unknown as OpenProposalWire["command"] },
    ];
    for (const over of bad) expect(() => proposalsView(wire([open(1, over)]))).toThrow("malformed open proposal 1");
    expect(() => proposalsView({ ...wire([]), vote: "vote" })).toThrow("not an address");
  });

  it("refuses more yes weight than the set holds, and takes all of it", () => {
    expect(() => proposalsView(wire([open(2, { yes_weight: "901" })]))).toThrow("more yes weight than its set holds");
    expect(proposalsView(wire([open(2, { yes_weight: "900" })])).open[0]?.tally).toEqual({ yes: 900n, total: 900n });
  });
});

describe("governanceView", () => {
  const governance: GovernanceWire = {
    config: { vote: VOTE, restriction_ttl_ms: 86_400_000 },
    pending: [{ proposal: 7, command: { action: "activate_protocol", version: "V57" }, applies_at: 9_000 }],
    restrictions: {
      "9": { limit: { kind: "reduce_only", market: 2 }, command_hash: HASH, expires_at: 8_000 },
      "8": { limit: { kind: "stress_floor", market: null, level: 1 }, command_hash: HASH, expires_at: 8_000 },
      "3": { limit: { kind: "params", closeout_level_bps: 5500 }, command_hash: HASH, expires_at: 9_500 },
    },
    params_baseline: { closeout_level_bps: 5000, house_total_cap_bps: 3000, house_total_cap_floor: "0" },
  };

  it("is empty before the log records any vote", () => {
    expect(governanceView(null)).toEqual(NO_GOVERNANCE);
    expect(governanceView({})).toEqual(NO_GOVERNANCE);
  });

  it("lists the waiting changes in the order they apply and the restrictions soonest lapsing first, ties by proposal", () => {
    const view = governanceView(governance);
    expect(view).toMatchObject({ vote: VOTE.toLowerCase(), restrictionTtlMs: 86_400_000, paramsBaseline: governance.params_baseline, marketBaselines: {} });
    expect(view.waiting).toEqual([{ id: 7, command: { action: "activate_protocol", version: "V57" }, appliesAtMs: 9_000 }]);
    expect(view.inForce.map((restriction) => [restriction.id, restriction.expiresAtMs])).toEqual([[8, 8_000], [9, 8_000], [3, 9_500]]);
  });

  it("refuses a malformed vote contract, change or restriction", () => {
    expect(() => governanceView({ config: { vote: "nope", restriction_ttl_ms: 1 } })).toThrow("malformed vote contract");
    expect(() => governanceView({ pending: [{ proposal: 1, command: { action: "x" }, applies_at: -5 }] })).toThrow("malformed waiting change");
    expect(() => governanceView({ restrictions: { x: { limit: { kind: "reduce_only", market: null }, command_hash: HASH, expires_at: 1 } } })).toThrow("malformed restriction");
  });
});

describe("the two-thirds rule", () => {
  it("passes only past two thirds, as ParameterVote.passes compares 3 * yes with 2 * total", () => {
    expect(passes({ yes: 600n, total: 900n })).toBe(false);
    expect(passes({ yes: 601n, total: 900n })).toBe(true);
    expect(passes({ yes: 2n, total: 3n })).toBe(false);
    expect(passes({ yes: 3n, total: 3n })).toBe(true);
    expect(passes({ yes: 0n, total: 0n })).toBe(false);
  });

  it("needs the least weight that passes, and nothing once it does", () => {
    expect(weightToPass({ yes: 400n, total: 900n })).toBe(201n);
    expect(weightToPass({ yes: 600n, total: 900n })).toBe(1n);
    expect(weightToPass({ yes: 601n, total: 900n })).toBe(0n);
    expect(weightToPass({ yes: 5n, total: 10n })).toBe(2n);
    expect(passes({ yes: 7n, total: 10n })).toBe(true);
    expect(passes({ yes: 6n, total: 10n })).toBe(false);
  });

  it("states the yes share in basis points, truncated, and zero for an empty set", () => {
    expect(yesShareBps({ yes: 2n, total: 3n })).toBe(6_666);
    expect(yesShareBps({ yes: 900n, total: 900n })).toBe(10_000);
    expect(yesShareBps({ yes: 0n, total: 0n })).toBe(0);
  });
});
