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
    const first = decodeMarket(view, undefined, true);
    expect(first.reference).toBe(first.mark);
    const moved = decodeMarket({ ...view, mark: "70000" }, first, true);
    expect(moved.mark).toBe(fixedFromInt(70_000));
    expect(moved.reference).toBe(first.reference);
  });

  it("keeps the mock's close-spread ceiling only for a simulated market, never for a live node's, which serves none", async () => {
    const node = createMockNode(START);
    const [view] = await node.client.markets();
    if (!view) throw new Error("a market is listed");
    expect(decodeMarket(view, undefined, true).ceilingBps).toBe(30);
    expect(decodeMarket(view, undefined, false).ceilingBps).toBeNull();
  });

  it("has no mark or reference before the first price", async () => {
    const node = createMockNode(START);
    const [view] = await node.client.markets();
    if (!view) throw new Error("a market is listed");
    const model = decodeMarket({ ...view, mark: null }, undefined, true);
    expect(model.mark).toBeNull();
    expect(model.reference).toBeNull();
  });
});

describe("metaFor", () => {
  it("names the listed markets and falls back plainly for an unknown one", () => {
    expect(metaFor("BTC-USD")).toMatchObject({ name: "Bitcoin", places: 2 });
    expect(metaFor("NEW-USD")).toEqual({ name: "NEW-USD", places: 4, closeCeilingBps: null });
  });
});

describe("decodeAccount's close fees", () => {
  it("reads each position's open time, rate and next fall, and none for a node that sends none or a malformed one", () => {
    const view = { balance: "1", equity: "1", margin: "0", toxicity_bps: 0, orders: {}, positions: { "1": { qty: "1", entry: "100" }, "2": { qty: "1", entry: "100" }, "3": { qty: "1", entry: "100" }, "4": { qty: "1", entry: "100" } } };
    const close_fees = { "1": { opened_at: 1_000, fee_bps: 6_421, falls_at: 61_005 }, "2": { opened_at: 1_000, fee_bps: 1_000, falls_at: null }, "3": { opened_at: "soon", fee_bps: 1_000, falls_at: null } as never };
    expect(decodeAccount({ ...view, close_fees }).positions.map((p) => p.closeFee)).toEqual([
      { openedAt: 1_000, feeBps: 6_421, fallsAt: 61_005 },
      { openedAt: 1_000, feeBps: 1_000, fallsAt: null },
      null,
      null,
    ]);
    expect(decodeAccount(view).positions.map((p) => p.closeFee)).toEqual([null, null, null, null]);
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
    expect(account.positions).toEqual([{ market: 1, qty: fixedFromInt(-2), entry: fixedFromInt(30_000), closeout: null, closeFee: null }]);
  });

  it("reads each position's close-out, and leaves a dash for a node that sends none or a malformed one", () => {
    const view = {
      balance: "100", equity: "99", margin: "10", toxicity_bps: 0, orders: {},
      positions: { "1": { qty: "1", entry: "100" }, "2": { qty: "1", entry: "100" }, "3": { qty: "1", entry: "100" }, "4": { qty: "1", entry: "100" }, "5": { qty: "1", entry: "100" }, "6": { qty: "1", entry: "100" } },
    };
    const closeouts = [
      { market: 1, reach: "at" as const, price: "84210.5263" },
      { market: 2, reach: "due" as const, price: null },
      { market: 3, reach: "beyond" as const, price: null },
      { market: 4, reach: "at" as const, price: null },
      { market: 5, reach: "soon" as never, price: null },
      { market: 6, reach: "at" as const, price: "not a price" },
    ];
    expect(decodeAccount({ ...view, closeouts }).positions.map((p) => p.closeout)).toEqual([
      { reach: "at", price: 84_210_526_300_000n },
      { reach: "due" },
      { reach: "beyond" },
      null,
      null,
      null,
    ]);
    expect(decodeAccount(view).positions.map((p) => p.closeout)).toEqual([null, null, null, null, null, null]);
  });
});

describe("decodeAccount's tier standing", () => {
  const view = { balance: "10000", equity: "10000", margin: "1000", toxicity_bps: 0, orders: {}, positions: {} };
  const standing = {
    initial_margin: "2500", maintenance_margin: "500", withdrawable: "7500", max_leverage: { "1": "20", "2": "20" },
    toxicity: { score: "5.5", fills: "40", tier: 1, add_on_bps: 2 },
    volume: { tier: 1, matured: "1000000", pending: "10", progress: [{ capped: "0", days: 0 }], best_price_bounds: { "1": "1000000" }, max_resting_orders: 50, requests_per_second: 5 },
  };

  it("reads the requirement, withdrawable cash, each market's leverage, the toxicity tier and the volume", () => {
    const account = decodeAccount({ ...view, ...standing });
    expect(account.requirements).toEqual({ initialMargin: fixedFromInt(2_500), maintenanceMargin: fixedFromInt(500), withdrawable: fixedFromInt(7_500), maxLeverage: new Map([[1, fixedFromInt(20)], [2, fixedFromInt(20)]]) });
    expect(account.toxicity).toEqual({ tier: 1, addOnBps: 2 });
    expect(account.volume).toMatchObject({ tier: 1, matured: fixedFromInt(1_000_000), maxRestingOrders: 50 });
  });

  it("has no key for what a node that predates it does not send, and none for a figure that is malformed", () => {
    expect(Object.keys(decodeAccount(view))).not.toEqual(expect.arrayContaining(["requirements"]));
    const bare = decodeAccount(view);
    expect([bare.requirements, bare.volume, bare.toxicity]).toEqual([undefined, undefined, undefined]);
    expect(decodeAccount({ ...view, ...standing, initial_margin: "lots" }).requirements).toBeUndefined();
    expect(decodeAccount({ ...view, ...standing, max_leverage: { one: "20" } }).requirements).toBeUndefined();
    expect(decodeAccount({ ...view, ...standing, toxicity: { ...standing.toxicity, tier: 1.5 } }).toxicity).toBeUndefined();
  });
});
