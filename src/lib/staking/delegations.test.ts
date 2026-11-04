/** Tests that the page's mirror of `Staking.sol`'s delegation rules reduces and reorders delegations as the contract does (monkey-trading/engine#586). */

import { describe, expect, it } from "vitest";

import { MONKEY_UNIT } from "../format";
import { applyChange, delegatedOf, delegationTo, undelegatedOf, unstakeTakes } from "./delegations";
import { unstakeWords } from "./delegation-words";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";
const M = MONKEY_UNIT;

describe("the account's split", () => {
  it("adds up what the delegations hold, and leaves the rest of the stake undelegated", () => {
    const delegations = [{ candidate: A, amount: 300n * M }, { candidate: B, amount: 200n * M }];
    expect(delegatedOf(delegations)).toBe(500n * M);
    expect(undelegatedOf(1_000n * M, delegations)).toBe(500n * M);
    expect(undelegatedOf(400n * M, delegations)).toBe(0n);
    expect([delegationTo(delegations, B), delegationTo(delegations, C)]).toEqual([200n * M, 0n]);
  });
});

describe("unstakeTakes", () => {
  it("takes an unstake within the undelegated stake from it alone, reading no delegation", () => {
    expect(unstakeTakes(1_000n, [{ candidate: A, amount: 600n }], 400n)).toEqual({ fromUndelegated: 400n, reductions: [] });
  });

  it("takes the rest from the delegations in proportion, from the last to the first, the first giving what remains", () => {
    // #586's scenario: 1,000 staked, 300 then 200 delegated, 100 moved to the second, 100 taken back, then 700 unstaked.
    const delegations = [{ candidate: A, amount: 200n * M }, { candidate: B, amount: 200n * M }];
    expect(unstakeTakes(1_000n * M, delegations, 700n * M)).toEqual({ fromUndelegated: 600n * M, reductions: [{ candidate: A, amount: 50n * M }, { candidate: B, amount: 50n * M }] });
  });

  it("rounds each share down as `Math.mulDiv` does, so the first listed absorbs the remainder and the sum is exact", () => {
    const delegations = [{ candidate: A, amount: 1n }, { candidate: B, amount: 1n }, { candidate: C, amount: 1n }];
    // 2 from 3: C gives 2*1/3 = 0, B gives 2*1/2 = 1, A gives what remains, 1.
    expect(unstakeTakes(3n, delegations, 2n)).toEqual({ fromUndelegated: 0n, reductions: [{ candidate: A, amount: 1n }, { candidate: B, amount: 1n }] });
    const uneven = [{ candidate: A, amount: 7n }, { candidate: B, amount: 5n }, { candidate: C, amount: 11n }];
    const { reductions } = unstakeTakes(30n, uneven, 17n);
    expect(reductions.reduce((sum, cut) => sum + cut.amount, 0n)).toBe(10n);
    // 7 undelegated, then 10 from 23: C gives 10*11/23 = 4, B 6*5/12 = 2, and A the 4 that remain.
    expect(reductions).toEqual([{ candidate: A, amount: 4n }, { candidate: B, amount: 2n }, { candidate: C, amount: 4n }]);
  });

  it("empties every delegation for an unstake of the whole stake", () => {
    const delegations = [{ candidate: A, amount: 300n }, { candidate: B, amount: 100n }];
    expect(unstakeTakes(400n, delegations, 400n).reductions).toEqual(delegations);
  });

  it("refuses an amount that is not positive or that passes the stake", () => {
    expect(() => unstakeTakes(10n, [], 0n)).toThrow("positive amount");
    expect(() => unstakeTakes(10n, [], 11n)).toThrow("positive amount");
  });
});

describe("applyChange", () => {
  const held = [{ candidate: A, amount: 3n }, { candidate: B, amount: 2n }, { candidate: C, amount: 1n }];

  it("adds to a delegation in place, and puts a new candidate at the end", () => {
    expect(applyChange(held, { candidate: B, amount: 5n })).toEqual([{ candidate: A, amount: 3n }, { candidate: B, amount: 7n }, { candidate: C, amount: 1n }]);
    expect(applyChange([], { candidate: A, amount: 4n })).toEqual([{ candidate: A, amount: 4n }]);
  });

  it("drops an emptied delegation as `EnumerableSet` does, the last entry taking its place", () => {
    expect(applyChange(held, { candidate: A, amount: -3n })).toEqual([{ candidate: C, amount: 1n }, { candidate: B, amount: 2n }]);
    expect(applyChange(held, { candidate: C, amount: -1n })).toEqual([{ candidate: A, amount: 3n }, { candidate: B, amount: 2n }]);
  });

  it("refuses to take a delegation below zero, and adds nothing for a zero change to one not held", () => {
    expect(() => applyChange(held, { candidate: B, amount: -3n })).toThrow("below zero");
    expect(applyChange(held, { candidate: "0x00000000000000000000000000000000000000ff", amount: 0n })).toEqual(held);
  });
});

describe("unstakeWords", () => {
  const label = (address: string) => (address === A ? "alpha.example" : "bravo.example");

  it("says an unstake within the undelegated stake changes no delegation", () => {
    expect(unstakeWords(1_000n * M, [{ candidate: A, amount: 500n * M }], 400n * M, label)).toBe("This takes 400 MONKEY from your undelegated stake, so no delegation changes.");
  });

  it("names each delegation a larger one reduces, and by how much, after all of the undelegated stake", () => {
    const delegations = [{ candidate: A, amount: 200n * M }, { candidate: B, amount: 200n * M }];
    expect(unstakeWords(1_000n * M, delegations, 700n * M, label)).toBe("This takes all 600 MONKEY of your undelegated stake, then 50 MONKEY from your delegation to alpha.example and 50 MONKEY from your delegation to bravo.example.");
    expect(unstakeWords(400n * M, delegations, 100n * M, label)).toBe("This takes 50 MONKEY from your delegation to alpha.example and 50 MONKEY from your delegation to bravo.example.");
  });

  it("says nothing for an amount the stake does not cover", () => {
    expect(unstakeWords(10n, [], 11n, label)).toBeNull();
    expect(unstakeWords(10n, [], 0n, label)).toBeNull();
  });
});
