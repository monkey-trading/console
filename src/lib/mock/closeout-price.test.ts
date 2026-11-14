/** The mock's close-out prices against its own close-out rule: moved just past the price the account is closed out, and just short of it it is not. */

import { describe, expect, it } from "vitest";

import { fixedFromInt, fixedFromWire, mulFixed, type Fixed } from "../fixed";
import { closeOutUnderwater } from "./closeout";
import { closeoutsOf } from "./closeout-price";
import { createMockNode } from "./index";
import type { MockState } from "./state";
import { funded, ME, START } from "./test-helpers";

/** A fresh mock state with `ME` holding `held` (market, signed quantity, and the percent the entry sits above the mark, none by default) on `balance`. */
function build(balance: number, held: [number, number, number?][]): MockState {
  const { state } = createMockNode(START).client;
  const account = state.account(ME);
  account.balance = fixedFromInt(balance);
  for (const [id, qty, above = 0] of held) {
    const mid = state.markets.get(id)?.mid;
    if (mid === undefined) throw new Error(`market ${id} is listed`);
    account.positions.set(id, { qty: fixedFromInt(qty), entry: (mid * BigInt(100 + above)) / 100n, openedAt: 0 });
  }
  return state;
}

/** Whether moving `id` to `price` closes the account out. */
function closesAt(make: () => MockState, id: number, price: Fixed): boolean {
  const state = make();
  const market = state.markets.get(id);
  if (market === undefined) throw new Error(`market ${id} is listed`);
  market.mid = price;
  return closeOutUnderwater(state).some((event) => event.type === "close_out");
}

/** The price `make`'s account is told for `id`, checked a millionth either side against the rule. */
function agrees(make: () => MockState, id: number): Fixed {
  const state = make();
  const found = closeoutsOf(state, state.account(ME)).find((c) => c.market === id);
  if (found?.reach !== "at" || found.price === null) throw new Error(`a price for ${id}: ${JSON.stringify(found)}`);
  const price = fixedFromWire(found.price);
  const mark = make().markets.get(id)?.mid ?? 0n;
  const slip = price / 1_000_000n;
  const [short, past] = price < mark ? [price + slip, price - slip] : [price - slip, price + slip];
  expect(closesAt(make, id, short)).toBe(false);
  expect(closesAt(make, id, past)).toBe(true);
  return price;
}

describe("the mock's close-out prices", () => {
  it("price a long below its mark and a short above it where the mock closes the account out", () => {
    const long = agrees(() => build(2_000, [[1, 1]]), 1);
    const mark = build(0, []).markets.get(1)?.mid ?? 0n;
    expect(long < mark).toBe(true);
    expect(agrees(() => build(2_000, [[1, -1]]), 1) > mark).toBe(true);
  });

  it("follow the margin across a band, which a flat margin would miss", () => {
    // 3 BTC is 202k of notional in the 5% band over 100k; on 120k of equity the close-out is at 27.7k, 83k of notional, under the band's start.
    const price = agrees(() => build(120_000, [[1, 3]]), 1);
    expect(mulFixed(price, fixedFromInt(3)) < fixedFromInt(100_000)).toBe(true);
    // A short rising through the 1M band edge, and a long of 30 BTC falling through both edges.
    expect(mulFixed(agrees(() => build(900_000, [[1, -3]]), 1), fixedFromInt(3)) > fixedFromInt(1_000_000)).toBe(true);
    expect(mulFixed(agrees(() => build(2_000_000, [[1, 30]]), 1), fixedFromInt(30)) < fixedFromInt(100_000)).toBe(true);
  });

  it("hold an account's other positions at their marks, so a second position moves the first's price", () => {
    const alone = agrees(() => build(5_000, [[1, 1]]), 1);
    const both = agrees(() => build(5_000, [[1, 1], [2, 20]]), 1);
    expect(both > alone).toBe(true);
    agrees(() => build(5_000, [[1, 1], [2, 20]]), 2);
  });

  it("count another position's unrealised profit or loss in the equity they are measured against", () => {
    // BTC bought below its mark is in profit and ETH bought above its mark is in loss, so the account's equity is neither its balance nor the flat-entry figure.
    const flat = agrees(() => build(12_000, [[1, 1], [2, 20]]), 1);
    const profit = agrees(() => build(12_000, [[1, 1], [2, 20, -10]]), 1);
    const loss = agrees(() => build(12_000, [[1, 1], [2, 20, 10]]), 1);
    // More equity leaves BTC further from its close-out; less brings it closer.
    expect(profit < flat).toBe(true);
    expect(loss > flat).toBe(true);
    // And the price holds for the position that is itself in profit or in loss.
    agrees(() => build(12_000, [[1, 1, -10], [2, 20, 10]]), 1);
    agrees(() => build(12_000, [[1, 1, -10], [2, 20, 10]]), 2);
    agrees(() => build(12_000, [[1, 1, 10], [2, 20, -10]]), 1);
  });

  it("say Due for an account already below the level and None for one no price in the range reaches", () => {
    const poor = build(10, [[1, 1]]);
    const due = closeoutsOf(poor, poor.account(ME));
    expect(due).toEqual([{ market: 1, reach: "due", price: null }]);
    const state = build(5_000_000, [[1, 1]]);
    expect(closeoutsOf(state, state.account(ME))).toEqual([{ market: 1, reach: "beyond", price: null }]);
    const short = build(5_000_000, [[1, -1]]);
    expect(closeoutsOf(short, short.account(ME))).toEqual([{ market: 1, reach: "beyond", price: null }]);
  });

  it("are served in the account read beside the positions", async () => {
    const node = await funded(2_000);
    const account = node.client.state.account(ME);
    account.positions.set(1, { qty: fixedFromInt(1), entry: node.client.state.markets.get(1)?.mid ?? 0n, openedAt: 0 });
    const view = await node.client.account(ME);
    expect(view.closeouts).toHaveLength(1);
    expect(view.closeouts?.[0]).toMatchObject({ market: 1, reach: "at" });
  });
});
