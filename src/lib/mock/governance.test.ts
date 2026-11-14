import { describe, expect, it } from "vitest";

import { MONKEY_UNIT } from "../format";
import { MockGovernance } from "./governance";
import { createMockNode } from "./index";
import { funded, order, START as NODE_START } from "./test-helpers";

const START = 1_800_000_000_000;
const MINUTE = 60_000;
const DAY = 86_400_000;
const A = "0xa100000000000000000000000000000000000000";
const B = "0xb200000000000000000000000000000000000000";
const C = "0xc300000000000000000000000000000000000000";
const D = "0xd400000000000000000000000000000000000000";
const E = "0xe500000000000000000000000000000000000000";
const governance = () => new MockGovernance(START, [A, B, C, D, E].map((address) => ({ address })));

describe("MockGovernance", () => {
  it("lists the two proposals taking votes, newest first, with their tallies over the four leaders' set", () => {
    const { open, vote } = governance().openProposals(START);
    expect(vote).toBe(`0x${"7a".repeat(20)}`);
    expect(open.map((proposal) => [proposal.id, proposal.fast, proposal.yes_weight, proposal.total_weight])).toEqual([
      [8, true, (400_000n * MONKEY_UNIT).toString(), (1_000_000n * MONKEY_UNIT).toString()],
      [7, false, (500_000n * MONKEY_UNIT).toString(), (1_000_000n * MONKEY_UNIT).toString()],
    ]);
  });

  it("applies the waiting change at its time and lapses the restriction at its end, as the engine does at its next command", () => {
    const mock = governance();
    expect(mock.houseGovernance(START).pending?.map((change) => [change.proposal, change.applies_at])).toEqual([[5, START + 3 * MINUTE]]);
    expect(mock.houseGovernance(START + 3 * MINUTE).pending).toEqual([]);
    const fresh = governance();
    expect(Object.keys(fresh.houseGovernance(START).restrictions ?? {})).toEqual(["6"]);
    expect(fresh.houseGovernance(START + 22 * 3_600_000 - 1).restrictions).toHaveProperty("6.expires_at", START + 22 * 3_600_000);
    expect(fresh.houseGovernance(START + 22 * 3_600_000).restrictions).toEqual({});
  });

  it("passes a proposal once its yes weight is past two thirds, a normal one to wait seven days and a fast one into force", () => {
    const mock = governance();
    mock.castVote(7, B, START);
    expect(mock.openProposals(START).open.map((proposal) => proposal.id)).toEqual([8]);
    expect(mock.houseGovernance(START).pending?.map((change) => [change.proposal, change.applies_at])).toEqual([[5, START + 3 * MINUTE], [7, START + 7 * DAY]]);
    mock.castVote(8, C, START);
    expect(mock.houseGovernance(START).restrictions?.["8"]).toBeUndefined();
    mock.castVote(8, B, START);
    expect(mock.houseGovernance(START).restrictions?.["8"]).toMatchObject({ limit: { kind: "reduce_only", market: 5 }, expires_at: START + DAY });
    expect(mock.proposal(8)).toMatchObject({ passed: true, yes: 900_000n * MONKEY_UNIT });
  });

  it("refuses a vote as the contract does", () => {
    const mock = governance();
    expect(() => mock.castVote(99, A, START)).toThrow("holds no proposal by this number");
    expect(() => mock.castVote(5, C, START)).toThrow("already passed");
    expect(() => mock.castVote(8, B, START + DAY)).toThrow("voting window has closed");
    expect(() => mock.castVote(8, E, START)).toThrow("not a member");
    expect(() => mock.castVote(8, A, START)).toThrow("already holds this account's vote");
  });

  it("answers the contract's reads: a proposal, the set, and each member's vote", () => {
    const mock = governance();
    expect(mock.proposal(4)).toBeNull();
    expect(mock.set(2)).toEqual([]);
    expect(mock.set(1).map((member) => member.candidate)).toEqual([A, B, C, D]);
    expect(mock.voted(7, D)).toBe(true);
    expect(mock.voted(7, C)).toBe(false);
  });
});

describe("restrictions in the mock's trading", () => {
  it("holds a market's stress level at a floor in force, and not once it lapses", () => {
    const mock = governance();
    expect(mock.floorAt(4, START)).toBe(1);
    expect(mock.floorAt(1, START)).toBe(0);
    expect(mock.floorAt(4, START + 22 * 3_600_000)).toBe(0);
    const node = createMockNode(NODE_START);
    node.client.tick(NODE_START + 5_000);
    expect(node.client.marketViews().find((market) => market.id === 4)?.stress_level).toBe(1);
  });

  it("stops new risk in a market a reduce-only restriction holds, as the market list says", async () => {
    const node = await funded(100_000);
    const { governance: mock, now } = node.client.state;
    expect(mock.reduceOnlyAt(5, now)).toBe(false);
    mock.castVote(8, mock.set(1)[1]?.candidate ?? "", now);
    expect(mock.reduceOnlyAt(5, now)).toBe(true);
    expect(node.client.marketViews().find((market) => market.id === 5)?.reduce_only).toBe(true);
    const refused = await order(node, "1", "buy", {}, 5);
    expect(refused.events.at(-1)).toMatchObject({ type: "order_rejected", reason: { kind: "reduce_only" } });
  });
});
