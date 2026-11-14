import { describe, expect, it } from "vitest";

import type { ChainProposal } from "../engine/governance-wallet";
import { fold, MAX_CALLS, NO_FACTS, plan, setOf, standing, voteKey, weightIn, type MemberVoteFacts, type VoteAnswer } from "./member-votes";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const C = "0x00000000000000000000000000000000000000cc";
const PASSED: ChainProposal = { setId: 2, fast: true, passed: true, closesAtMs: 5_000, yes: 700n, total: 900n };

/** `facts` after each answer in turn. */
const after = (answers: VoteAnswer[], facts: MemberVoteFacts = NO_FACTS) => answers.reduce(fold, facts);
const SET_1: VoteAnswer = { kind: "set", setId: 1, members: new Map([[A, 400n], [B, 500n]]) };

describe("plan", () => {
  it("reads a passed proposal's set from the chain, then each set once, then each member in it, open proposals first", () => {
    const targets = [{ id: 3, setId: null, open: false }, { id: 5, setId: 1, open: true }, { id: 4, setId: 1, open: true }];
    expect(plan(NO_FACTS, targets, [A, C])).toEqual([{ kind: "proposal", id: 3 }, { kind: "set", setId: 1 }]);
    const known = after([{ kind: "proposal", id: 3, proposal: PASSED }, SET_1, { kind: "set", setId: 2, members: new Map([[C, 900n]]) }]);
    expect(plan(known, targets, [A, C])).toEqual([
      { kind: "voted", id: 5, member: A, open: true },
      { kind: "voted", id: 4, member: A, open: true },
      { kind: "voted", id: 3, member: C, open: false },
    ]);
  });

  it("reads nothing for an account that delegates to no one and is no member, and nothing more once every answer is final", () => {
    expect(plan(NO_FACTS, [{ id: 1, setId: 1, open: true }], [])).toEqual([]);
    const final = after([SET_1, { kind: "voted", id: 1, member: A, open: true, voted: true }, { kind: "voted", id: 2, member: A, open: false, voted: false }]);
    expect(plan(final, [{ id: 1, setId: 1, open: true }, { id: 2, setId: 1, open: false }], [A, C])).toEqual([]);
  });

  it("reads an open proposal's member again while it has not voted, and a closed one's once", () => {
    const facts = after([SET_1, { kind: "voted", id: 1, member: A, open: true, voted: false }]);
    expect(plan(facts, [{ id: 1, setId: 1, open: true }], [A])).toEqual([{ kind: "voted", id: 1, member: A, open: true }]);
    expect(plan(facts, [{ id: 1, setId: 1, open: false }], [A])).toEqual([{ kind: "voted", id: 1, member: A, open: false }]);
    expect(plan(after([{ kind: "voted", id: 1, member: A, open: false, voted: false }], facts), [{ id: 1, setId: 1, open: false }], [A])).toEqual([]);
  });

  it("asks nothing again of a proposal the chain does not hold", () => {
    const facts = after([{ kind: "proposal", id: 9, proposal: null }]);
    expect(plan(facts, [{ id: 9, setId: null, open: false }], [A])).toEqual([]);
    expect(standing(facts, { id: 9, setId: null }, A)).toBe("unknown");
  });

  it("makes at most MAX_CALLS calls in one read", () => {
    const targets = Array.from({ length: MAX_CALLS + 5 }, (_, i) => ({ id: i + 1, setId: 1, open: true }));
    expect(plan(after([SET_1]), targets, [A])).toHaveLength(MAX_CALLS);
  });
});

describe("standing and weight", () => {
  const facts = after([SET_1, { kind: "proposal", id: 3, proposal: PASSED }, { kind: "voted", id: 1, member: A, open: true, voted: true }, { kind: "voted", id: 1, member: B, open: true, voted: false }]);

  it("tells a yes, a member without one, an account outside the set, and what is not read yet", () => {
    expect(standing(facts, { id: 1, setId: 1 }, A)).toBe("yes");
    expect(standing(facts, { id: 1, setId: 1 }, B)).toBe("no");
    expect(standing(facts, { id: 1, setId: 1 }, C)).toBe("outside");
    expect(standing(facts, { id: 2, setId: 1 }, A)).toBe("unknown");
    expect(standing(facts, { id: 3, setId: null }, A)).toBe("unknown"); // set 2 not read yet
  });

  it("weighs a member by its set's weight, zero outside it, and nothing before the set is read", () => {
    expect(weightIn(facts, { id: 1, setId: 1 }, B)).toBe(500n);
    expect(weightIn(facts, { id: 1, setId: 1 }, C)).toBe(0n);
    expect(weightIn(facts, { id: 3, setId: null }, C)).toBeNull();
    expect(setOf(facts, { id: 3, setId: null })).toBe(2);
  });

  it("keeps a yes final whatever the proposal's state, and a no final only when read while it took no votes", () => {
    expect(facts.voted.get(voteKey(1, A))).toEqual({ voted: true, final: true });
    expect(facts.voted.get(voteKey(1, B))).toEqual({ voted: false, final: false });
  });
});
