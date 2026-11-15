/** Tests for the mock's volume tiers, as the engine counts them (V59), prices them (best price), charges them (V64's margin floor) and limits them (V66). */

import { describe, expect, it } from "vitest";

import type { AccountView } from "../engine/types";
import { fixedFromInt, fixedToWire } from "../fixed";
import { DAY_MS, MIN_HOLD_MS, recordFill } from "./volume";
import type { MockNode } from "./index";
import { funded, ME, order } from "./test-helpers";

const view = async (node: MockNode): Promise<AccountView> => node.client.account(ME);
const volumeOf = async (node: MockNode) => (await view(node)).volume;

/** Holds BTC-USD's index at `dollars`. */
function pin(node: MockNode, dollars: number): void {
  const runtime = node.client.state.markets.get(1);
  if (runtime === undefined) throw new Error("the mock lists BTC-USD");
  runtime.mid = fixedFromInt(dollars);
}

/** Gives the account counted volume of `dollars` on each of the last `days` UTC days of the node's clock. */
function seedDays(node: MockNode, dollars: number, days: number): void {
  const { state } = node.client;
  const today = Math.floor(state.now / DAY_MS);
  for (let i = 0; i < days; i++) state.account(ME).volume.days.set(today - i, fixedFromInt(dollars));
}

describe("a fresh account", () => {
  it("is at tier 0 with nothing counted, a quarter of each market's first band at the best price, and the tier's limits", async () => {
    const volume = await volumeOf(await funded(10_000));
    expect(volume).toMatchObject({ tier: 0, matured: "0", pending: "0", max_resting_orders: 25, requests_per_second: 2 });
    expect(volume?.progress).toHaveLength(4);
    // BTC-USD's first band ends at $2M: a quarter of it.
    expect(volume?.best_price_bounds["1"]).toBe("500000");
  });

  it("is charged each margin band at least 5%, which caps leverage at 20x and raises what an order and a withdrawal must leave", async () => {
    const node = await funded(10_000);
    pin(node, 100_000);
    await order(node, "0.5", "buy");
    const read = await view(node);
    // $50k at BTC's own 2% is $1,000 of margin; at the 5% floor the initial requirement is $2,500.
    expect([read.margin, read.initial_margin]).toEqual(["1000", "2500"]);
    expect(read.max_leverage?.["1"]).toBe("20");
    const equity = Number(read.equity);
    expect(Number(read.withdrawable)).toBeCloseTo(Math.min(equity - 2_500, Number(read.balance)), 6);
  });

  it("refuses a fill whose initial requirement at the floor exceeds equity, though the market's own margin would allow it", async () => {
    const node = await funded(4_000);
    pin(node, 100_000);
    // 1 BTC is $100k: $2,000 at the market's 2%, $5,000 at the floor.
    const refused = await order(node, "1", "buy");
    expect(refused.events[0]).toMatchObject({ type: "order_rejected", reason: { kind: "insufficient_margin", required: "5000" } });
    expect((await order(node, "0.5", "buy")).events[1]).toMatchObject({ type: "fill" });
  });
});

describe("counted volume", () => {
  it("is pending for the hold, then counts; a position closed before it counts nothing", async () => {
    const node = await funded(100_000);
    pin(node, 100_000);
    await order(node, "1", "buy");
    expect(await volumeOf(node)).toMatchObject({ matured: "0", pending: expect.stringMatching(/^100\d{3}(\.\d+)?$/) });
    node.client.tick(node.client.state.now + MIN_HOLD_MS + 1_000);
    pin(node, 100_000);
    const counted = await volumeOf(node);
    expect(Number(counted?.matured)).toBeGreaterThan(100_000);
    expect(counted?.pending).toBe("0");

    const fresh = await funded(100_000);
    pin(fresh, 100_000);
    await order(fresh, "1", "buy");
    await order(fresh, "1", "sell");
    fresh.client.tick(fresh.client.state.now + MIN_HOLD_MS + 1_000);
    expect((await volumeOf(fresh))?.matured).toBe("0");
  });

  it("counts a close of a position held through the hold once the round-trip horizon has passed", async () => {
    const node = await funded(100_000);
    pin(node, 100_000);
    await order(node, "1", "buy");
    node.client.tick(node.client.state.now + MIN_HOLD_MS + 1_000);
    pin(node, 100_000);
    const before = Number((await volumeOf(node))?.matured);
    await order(node, "1", "sell");
    expect(Number((await volumeOf(node))?.pending)).toBeGreaterThan(99_000);
    node.client.tick(node.client.state.now + 6_000);
    pin(node, 100_000);
    expect(Number((await volumeOf(node))?.matured)).toBeGreaterThan(before + 99_000);
  });
});

describe("a close that takes pending opening volume", () => {
  const pendingOf = async (node: MockNode) => Number((await volumeOf(node))?.pending);

  it("takes part of the newest lot, and what the lot keeps is its proportion rounded down", async () => {
    const node = await funded(100_000);
    pin(node, 100_000);
    await order(node, "1", "buy");
    const opened = (await volumeOf(node))?.pending ?? "0";
    await order(node, "0.4", "sell");
    // 0.6 of the lot is still pending, and the 0.4 closed counts nothing, now or after the hold.
    expect(await pendingOf(node)).toBeCloseTo(Number(opened) * 0.6, 3);
    node.client.tick(node.client.state.now + MIN_HOLD_MS + 1_000);
    pin(node, 100_000);
    expect(Number((await volumeOf(node))?.matured)).toBeCloseTo(Number(opened) * 0.6, 3);
  });

  it("rounds the lot's notional down when its proportion has a fraction of a raw unit", async () => {
    const node = await funded(100_000);
    const { state } = node.client;
    state.account(ME).volume.opening.set(1, [{ maturesAt: state.now + MIN_HOLD_MS, qty: 3n, notional: 10n }]);
    state.account(ME).positions.set(1, { qty: 3n, entry: 1n, openedAt: state.now });
    recordFill(state.account(ME).volume, { market: 1, held: 3n, delta: -1n, price: 1n, now: state.now, liquidation: false });
    // 2 of 3 units keep 10 * 2 / 3 = 6.67 raw units, which the engine keeps as 6.
    expect(state.account(ME).volume.opening.get(1)?.[0]?.notional).toBe(6n);
  });

  it("takes the newer lot first across lots, and counts only what is left of the close once the horizon has passed", async () => {
    const node = await funded(1_000_000);
    pin(node, 100_000);
    await order(node, "1", "buy");
    node.client.tick(node.client.state.now + MIN_HOLD_MS + 1_000);
    pin(node, 100_000);
    await order(node, "1", "buy");
    const counted = Number((await volumeOf(node))?.matured);
    // 1.5 closes the whole newer lot (pending) and half the older, matured one, which counts after the horizon.
    await order(node, "1.5", "sell");
    expect(await pendingOf(node)).toBeGreaterThan(49_000);
    expect(await pendingOf(node)).toBeLessThan(51_000);
    node.client.tick(node.client.state.now + 6_000);
    pin(node, 100_000);
    const after = await volumeOf(node);
    expect(Number(after?.pending)).toBe(0);
    expect(Number(after?.matured) - counted).toBeGreaterThan(49_000);
    expect(Number(after?.matured) - counted).toBeLessThan(51_000);
  });
});

describe("a higher tier", () => {
  it("is reached by a threshold of capped days: $1M over two days takes tier 1, and one $1M day does not", async () => {
    const day = await funded(10_000);
    seedDays(day, 1_000_000, 1);
    // One day counts at most $500k towards tier 1.
    expect(await volumeOf(day)).toMatchObject({ tier: 0, progress: [expect.anything(), { capped: "500000", days: 1 }, expect.anything(), expect.anything()] });

    const two = await funded(10_000);
    seedDays(two, 500_000, 2);
    expect(await volumeOf(two)).toMatchObject({ tier: 1, matured: "1000000", max_resting_orders: 50, requests_per_second: 5 });
  });

  it("widens the best-price band, lowers the margin floor to 2% and raises leverage to 50x", async () => {
    const node = await funded(10_000);
    seedDays(node, 500_000, 2);
    const read = await view(node);
    expect(read.volume?.best_price_bounds["1"]).toBe("1000000");
    expect(read.max_leverage?.["1"]).toBe("50");
    pin(node, 100_000);
    await order(node, "0.5", "buy");
    expect((await view(node)).initial_margin).toBe("1000");
  });

  it("charges no floor from tier 2, so a market's own bands apply", async () => {
    const node = await funded(10_000);
    seedDays(node, 5_000_000, 5);
    const read = await view(node);
    expect(read.volume?.tier).toBe(2);
    expect(read.max_leverage?.["1"]).toBe("50");
    expect(read.volume?.best_price_bounds["1"]).toBe("2000000");
  });

  it("drops volume that leaves the thirty-day window", async () => {
    const node = await funded(10_000);
    node.client.state.account(ME).volume.days.set(Math.floor(node.client.state.now / DAY_MS) - 31, fixedFromInt(5_000_000));
    expect((await volumeOf(node))?.matured).toBe("0");
  });
});

describe("pricing at the best price", () => {
  it("prices size past the account's first band at the second band's rate, so a higher tier pays less for the same order", async () => {
    const low = await funded(1_000_000);
    pin(low, 100_000);
    const high = await funded(1_000_000);
    seedDays(high, 5_000_000, 5);
    pin(high, 100_000);
    // $1M is inside the first band for tier 2 (to $2M) and past a quarter of it for tier 0 (to $500k).
    const [a, b] = [await order(low, "10", "buy"), await order(high, "10", "buy")];
    const price = (r: typeof a) => Number((r.events[1] as { price: string }).price);
    expect(price(a)).toBeGreaterThan(price(b));
  });
});

describe("the account read", () => {
  it("serves the margin standing, the toxicity score and the volume from V54, V59 and V64", async () => {
    const read = await view(await funded(10_000));
    expect(read.toxicity).toEqual({ score: "0", fills: "0", tier: 0, add_on_bps: 0 });
    expect(Object.keys(read.max_leverage ?? {})).toHaveLength(5);
    expect(read.maintenance_margin).toBe("0");
  });
});

describe("the V68 benefits", () => {
  it("serves the tier's fee discount, financing discount and emissions boost in the account read, zero named", async () => {
    const zero = await volumeOf(await funded(10_000));
    expect(zero).toMatchObject({ fee_discount_bps: 0, financing_discount_bps: 0, emissions_boost_bps: 0 });
    const node = await funded(10_000);
    seedDays(node, 5_000_000, 5);
    expect(await volumeOf(node)).toMatchObject({ tier: 2, fee_discount_bps: 1_000, financing_discount_bps: 1_000, emissions_boost_bps: 2_500 });
    const one = await funded(10_000);
    seedDays(one, 500_000, 2);
    expect(await volumeOf(one)).toMatchObject({ tier: 1, fee_discount_bps: 0, emissions_boost_bps: 1_000 });
  });

  it("charges a close past the curve the base less the tier's discount, in the read and in the fill", async () => {
    const [low, high] = [await funded(100_000), await funded(100_000)];
    seedDays(high, 5_000_000, 5);
    for (const node of [low, high]) {
      pin(node, 100_000);
      await order(node, "1", "buy");
      // Held past the fee's fifteen-minute curve, so a close pays the base.
      const held = node.client.state.account(ME).positions.get(1);
      if (held === undefined) throw new Error("no position");
      held.openedAt -= 20 * 60_000;
    }
    const fees = async (node: MockNode) => Object.values((await view(node)).close_fees ?? {}).map((f) => f.fee_bps);
    expect([await fees(low), await fees(high)]).toEqual([[1_000], [900]]);
    // A gain at a close pays that rate of it.
    for (const node of [low, high]) pin(node, 101_000);
    const gain = async (node: MockNode) => {
      const closed = await order(node, "1", "sell");
      return closed.events.find((e) => e.type === "fill");
    };
    expect(await gain(low)).toMatchObject({ profit_fee_bps: 1_000 });
    expect(await gain(high)).toMatchObject({ profit_fee_bps: 900 });
  });

  it("reads the tier at the period's end, not at the tick that closes it", async () => {
    const node = await funded(100_000);
    const { state } = node.client;
    pin(node, 100_000);
    await order(node, "1", "buy");
    node.controls.shock(1, -300);
    node.client.tick(state.now + 5_000);
    await order(node, "1", "sell");
    const losses = state.emission.results.get(ME)?.losses ?? 0n;
    const end = state.monkey.startMs + (state.emission.period + 1) * 600_000;
    // Four past days at tier 2's cap, and a fifth day's lot that matures 100 ms after the period ends: tier 1 then, tier 2 at the tick.
    const day = Math.floor((end + 100) / DAY_MS);
    for (let i = 1; i <= 4; i++) state.account(ME).volume.days.set(day - i, fixedFromInt(5_000_000));
    state.account(ME).volume.opening.set(2, [{ maturesAt: end + 100, qty: 1n, notional: fixedFromInt(5_000_000) }]);
    node.client.tick(end + 250);
    const allocated = state.log.flatMap((m) => m.events.flatMap((e) => (e.type === "emission_allocated" ? [e] : [])));
    expect(allocated[0]?.weight).toBe(fixedToWire(losses + (losses * 1_000n) / 10_000n));
  });

  it("grows an account's emission weight by its tier's boost, rounded down, with the tier read at the period's end", async () => {
    const node = await funded(100_000);
    seedDays(node, 5_000_000, 5);
    const allocated = () => node.client.state.log.flatMap((m) => m.events.flatMap((e) => (e.type === "emission_allocated" ? [e] : [])));
    pin(node, 100_000);
    await order(node, "1", "buy");
    node.controls.shock(1, -300);
    node.client.tick(node.client.state.now + 5_000);
    await order(node, "1", "sell");
    const losses = node.client.state.emission.results.get(ME)?.losses ?? 0n;
    expect(losses).toBeGreaterThan(0n);
    node.client.tick(node.client.state.now + 11 * 60_000);
    const [event] = allocated();
    // Tier 2's 2,500 bps weighs the losses 1.25 times.
    expect(event?.weight).toBe(fixedToWire(losses + (losses * 2_500n) / 10_000n));
  });
});
