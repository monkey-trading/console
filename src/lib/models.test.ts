/** Tests for the decoded view models. */

import { describe, expect, it } from "vitest";

import { metaFor } from "./engine/meta";
import { fixedFromInt } from "./fixed";
import { decodeAccount, decodeMarket } from "./models";
import { createMockNode } from "./mock";

const START = Date.UTC(2026, 9, 28, 15, 0, 0);

describe("decodeMarket", () => {
  it("keeps the session reference from the previous model while the mark moves", async () => {
    const node = createMockNode(START);
    const [view] = await node.client.markets();
    if (!view) throw new Error("a market is listed");
    const first = decodeMarket(view, undefined);
    expect(first.reference).toBe(first.mark);
    const moved = decodeMarket({ ...view, mark: "70000" }, first);
    expect(moved.mark).toBe(fixedFromInt(70_000));
    expect(moved.reference).toBe(first.reference);
  });

  it("has no mark or reference before the first price", async () => {
    const node = createMockNode(START);
    const [view] = await node.client.markets();
    if (!view) throw new Error("a market is listed");
    const model = decodeMarket({ ...view, mark: null }, undefined);
    expect(model.mark).toBeNull();
    expect(model.reference).toBeNull();
  });
});

describe("metaFor", () => {
  it("names the listed markets and falls back plainly for an unknown one", () => {
    expect(metaFor("BTC-USD")).toMatchObject({ name: "Bitcoin", places: 2 });
    expect(metaFor("NEW-USD")).toEqual({ name: "NEW-USD", places: 4, baseSpreadBps: 5 });
  });
});

describe("decodeAccount", () => {
  it("reads the node's strings into fixed point and lists positions and orders", () => {
    const account = decodeAccount({
      balance: "100.5", equity: "99", margin: "10", toxicity_bps: 0, unfinalised_deposits: "5",
      positions: { "1": { qty: "-2", entry: "30000" } }, orders: {},
    });
    expect(account.balance).toBe(100_500_000_000n);
    expect(account.unfinalised).toBe(fixedFromInt(5));
    expect(account.positions).toEqual([{ market: 1, qty: fixedFromInt(-2), entry: fixedFromInt(30_000) }]);
  });
});
