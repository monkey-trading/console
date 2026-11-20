/**
 * The mock's close-outs under the grid (monkey-trading/engine#913, D6): the least notional that restores the level, else the greatest
 * gain per dollar, an offset group kept together while every member it holds can trade; and a grouped position's close-out price.
 */

import { describe, expect, it } from "vitest";

import type { EngineEvent } from "../engine/types";
import { fixedFromInt, fixedFromWire, type Fixed } from "../fixed";
import { closeoutsOf } from "./closeout-price";
import { createMockNode } from "./index";
import { tierTable } from "./accounts";
import { quoteAtShare } from "./execute";
import { closeOutUnderwater, scoreMembers } from "./closeout";
import { closeoutShare, requirementOf } from "./portfolio";
import { DAY_MS } from "./volume";
import type { MockState } from "./state";
import { ME, START } from "./test-helpers";

/** A fresh state, BTC-USD at 100,000 and ETH-USD at 4,000, with `ME` holding `held` (market, signed units, the entry's distance above the mark), its balance set so equity is `slack` from its close-out level. */
function build(held: [number, Fixed, Fixed?][], slack: Fixed): MockState {
  const { state } = createMockNode(START).client;
  for (const [id, price] of [[1, 100_000], [2, 4_000]] as const) {
    const market = state.markets.get(id);
    if (market !== undefined) market.mid = fixedFromInt(price);
  }
  const account = state.account(ME);
  for (const [id, qty, above = 0n] of held) account.positions.set(id, { qty, entry: (state.markets.get(id)?.mid ?? 0n) + above, openedAt: START });
  const { equity, requirement } = requirementOf(state, account, { kind: "market" });
  account.balance = closeoutShare(state, requirement) - equity + slack;
  return state;
}

/** The markets the close-out fills, in order. */
const closed = (events: EngineEvent[]) => events.flatMap((event) => (event.type === "fill" ? [event.market] : []));

// $1.08M of EUR-USD long $10,000 under water, $137k of gold and $117k of the US 500 at their marks: no offset group among them.
const UNGROUPED: [number, Fixed, Fixed][] = [[3, fixedFromInt(1_000_000), 10_000_000n], [4, fixedFromInt(20), 0n], [5, fixedFromInt(50), 0n]];
const HEDGE: [number, Fixed][] = [[1, fixedFromInt(10)], [2, fixedFromInt(-200)]];

describe("the mock's close-outs under the grid", () => {
  it("close the least notional that restores the level, not the largest loser", () => {
    const state = build(UNGROUPED, fixedFromInt(-1_000));
    expect(closed(closeOutUnderwater(state))).toEqual([4]);
    expect([...state.account(ME).positions.keys()]).toEqual([3, 5]);
  });

  it("close the greatest gain per dollar first while nothing restores the level", () => {
    expect(closed(closeOutUnderwater(build(UNGROUPED, fixedFromInt(-50_000))))).toEqual([3, 4, 5]);
  });

  it("close an offset group whole, member by member in market order, and announce the requirement it read", () => {
    const events = closeOutUnderwater(build(HEDGE, fixedFromInt(-1_000)));
    expect(closed(events)).toEqual([1, 2]);
    expect(events[0]).toEqual({ type: "close_out", account: ME, equity: "20000", margin: "42000" });
  });

  it("score a group's second member at the volume tier the first member's close-out volume reaches", () => {
    // Yesterday's $600k counted, the BTC leg's $1M close-out today reaches tier 1, whose wider best-price band closes the ETH leg for less.
    const fresh = build(HEDGE, fixedFromInt(-1_000));
    const counted = build(HEDGE, fixedFromInt(-1_000));
    counted.account(ME).volume.days.set(Math.floor(START / DAY_MS) - 1, fixedFromInt(600_000));
    const [tier0, tier1] = tierTable(counted).map((tier) => tier.bestPriceShareBps);
    const ethAt = (share: number | undefined) => {
      const priced = quoteAtShare(counted, 2, "buy", fixedFromInt(200), fixedFromInt(-200), share);
      if (priced?.kind !== "priced") throw new Error("ETH-USD's close prices");
      return priced.price;
    };
    const cheaper = (ethAt(tier0) - ethAt(tier1)) * 200n;
    expect(cheaper > 0n).toBe(true);
    expect(scoreMembers(counted, counted.account(ME), [1])).toEqual(scoreMembers(fresh, fresh.account(ME), [1]));
    const [withTier, without] = [scoreMembers(counted, counted.account(ME), [1, 2]), scoreMembers(fresh, fresh.account(ME), [1, 2])];
    expect((withTier?.change ?? 0n) - (without?.change ?? 0n)).toBe(cheaper);
  });

  it("close a member alone while another it holds cannot trade, which waits", () => {
    const state = build(HEDGE, fixedFromInt(-1_000));
    const eth = state.markets.get(2);
    if (eth !== undefined) eth.halted = true;
    expect(closed(closeOutUnderwater(state))).toEqual([1]);
    expect([...state.account(ME).positions.keys()]).toEqual([2]);
  });
});

/** Whether moving `id` to `price` closes `make`'s account out. */
function closesAt(make: () => MockState, id: number, price: Fixed): boolean {
  const state = make();
  const market = state.markets.get(id);
  if (market === undefined) throw new Error(`market ${id} is listed`);
  market.mid = price;
  return closeOutUnderwater(state).some((event) => event.type === "close_out");
}

/** The close-out price `make`'s account is told for `id`, checked a millionth either side against the rule. */
function agrees(make: () => MockState, id: number): Fixed {
  const state = make();
  const found = closeoutsOf(state, state.account(ME)).find((c) => c.market === id);
  if (found?.reach !== "at" || found.price === null) throw new Error(`a price for ${id}: ${JSON.stringify(found)}`);
  const price = fixedFromWire(found.price);
  const mark = state.markets.get(id)?.mid ?? 0n;
  const slip = price / 1_000_000n;
  const [short, past] = price < mark ? [price + slip, price - slip] : [price - slip, price + slip];
  expect([closesAt(make, id, short), closesAt(make, id, past)]).toEqual([false, true]);
  return price;
}

describe("the mock's close-out prices under the grid", () => {
  // 10 BTC long against 150 ETH short: $750k of ETH's loading-weighted exposure matched, the rest of BTC's left long.
  const pair = (): MockState => build([[1, fixedFromInt(10)], [2, fixedFromInt(-150)]], fixedFromInt(5_000));

  it("find where each leg of a hedged pair closes the account out, the credit following its price", () => {
    expect(agrees(pair, 1) < fixedFromInt(100_000)).toBe(true);
    expect(agrees(pair, 2) > fixedFromInt(4_000)).toBe(true);
  });

  it("say None for each leg when no price in the range closes the account out", () => {
    const rich = build([[1, fixedFromInt(10)], [2, fixedFromInt(-150)]], fixedFromInt(100_000_000));
    expect(closeoutsOf(rich, rich.account(ME)).map((c) => c.reach)).toEqual(["beyond", "beyond"]);
  });
});
