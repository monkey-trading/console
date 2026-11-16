/** Tests for what the console shows of the account's volume tier: the panel's standing and benefits, and the ticket's limits and refusals. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import type { HouseParams } from "./house";
import type { AccountModel } from "./models";
import { accountPricing, describeBestPrice, describeBoost, describeDiscount, describeLimit, describeNextTier, leverageReason, orderLimitProblem, ticketLimits, tierBenefits, tierStanding, usdWhole } from "./tier-view";
import { decodeVolume, nextTier, decodeTiers } from "./volume-tier";
import { btc, q } from "./ticket-fixtures";

/** A market view to extend, with BTC-USD's bands. */
function btcShape() {
  return { spread_tiers: [{ up_to: "2000000", tenth_bps: 20 }, { up_to: "10000000", tenth_bps: 40 }, { up_to: null, tenth_bps: 80 }] };
}

const TABLE = [
  { threshold: "0", day_divisor: 1, best_price_share_bps: 2500, margin_floor_bps: 500, max_resting_orders: 25, requests_per_second: 2 },
  { threshold: "1000000", day_divisor: 2, best_price_share_bps: 5000, margin_floor_bps: 200, max_resting_orders: 50, requests_per_second: 5 },
  { threshold: "25000000", day_divisor: 5, best_price_share_bps: 10000, max_resting_orders: 100, requests_per_second: 10 },
];
const PARAMS: HouseParams = { profitFeeBps: 1_000, closeoutLevelBps: 5_000, totalCapBps: 20_000, totalCapFloor: 0n, stressLevels: [], profitFeeCurve: [], volumeTiers: TABLE, seq: 1 };
const wire = (tier: number) => ({ tier, matured: "400000", pending: "50", progress: TABLE.map(() => ({ capped: "400000", days: 1 })), best_price_bounds: { "1": "500000" }, max_resting_orders: 25, requests_per_second: 2 });
const account = (tier = 0, orders = 0): AccountModel => ({
  balance: fixedFromInt(10_000), unfinalised: 0n, equity: fixedFromInt(10_000), margin: 0n, positions: [],
  orders: Array.from({ length: orders }, (_, i) => ({ order_id: i + 1, client_id: i, market: 1, side: "buy", qty: "1", kind: { kind: "limit", price: "1" }, reduce_only: false })),
  requirements: { initialMargin: 0n, maintenanceMargin: 0n, withdrawable: fixedFromInt(10_000), maxLeverage: new Map([[1, fixedFromInt(20)]]) },
  volume: decodeVolume(wire(tier)) ?? undefined,
});

describe("tierStanding", () => {
  it("names the account's tier, the table and the step to the next tier", () => {
    const standing = tierStanding(account(), PARAMS);
    expect(standing?.tier).toBe(0);
    expect(standing?.table).toHaveLength(3);
    expect(standing?.next).toMatchObject({ tier: 1, daysNeeded: 2 });
  });

  it("has no next tier at the top, and no terms while the parameters are unread or do not reach the tier", () => {
    expect(tierStanding(account(2), PARAMS)?.next).toBeNull();
    expect(tierStanding(account(0), null)).toMatchObject({ table: null, next: null });
    expect(tierStanding(account(0), { ...PARAMS, volumeTiers: [] })).toMatchObject({ table: null });
    expect(tierStanding(account(3), PARAMS)).toMatchObject({ table: null });
  });

  it("is absent from a node that predates volume tiers, and for no account", () => {
    expect(tierStanding({ ...account(), volume: undefined }, PARAMS)).toBeNull();
    expect(tierStanding(null, PARAMS)).toBeNull();
  });
});

describe("tierBenefits", () => {
  it("states what this tier and the next bring in a market", async () => {
    const market = (await btc()).view;
    const standing = tierStanding(account(), PARAMS);
    const benefits = standing && tierBenefits(standing, market, 0);
    expect(benefits?.now).toMatchObject({ bestPriceBound: fixedFromInt(500_000), leverage: fixedFromInt(20), maxRestingOrders: 25, requestsPerSecond: 2 });
    expect(benefits?.next).toMatchObject({ bestPriceBound: fixedFromInt(1_000_000), leverage: fixedFromInt(50), maxRestingOrders: 50, requestsPerSecond: 5 });
    const top = tierStanding(account(2), PARAMS);
    expect(top && tierBenefits(top, market, 0)?.next).toBeNull();
  });

  it("has none while the table is unread", () => {
    const standing = tierStanding(account(), null);
    expect(standing && tierBenefits(standing, undefined, 0)).toBeNull();
  });
});

describe("a weekend margin that applies now", () => {
  const WTI = { ...btcShape(), margin_tiers: [{ up_to: "2000000", bps: 100 }, { up_to: null, bps: 500 }], weekend_margin: { weekend_margin_bps: 750, from: 1_000, close: 8_200_000, reopen: 90_000_000 } };

  it("holds the leverage of every tier to the weekend rate while it applies, and leaves them alone before and after", () => {
    const standing = tierStanding(account(), PARAMS);
    if (standing === null) throw new Error("no standing");
    const at = (now: number) => tierBenefits(standing, WTI as never, now);
    expect([at(500)?.now.leverage, at(500)?.next?.leverage]).toEqual([fixedFromInt(20), fixedFromInt(50)]);
    // 10,000 / 750 is 13.333333333, which the page names as 13x.
    expect([at(1_000)?.now.leverage, at(1_000)?.next?.leverage]).toEqual([13_333_333_333n, 13_333_333_333n]);
    expect(at(90_000_000)?.now.leverage).toBe(fixedFromInt(20));
  });

  it("names the weekend margin, not the tier, as what sets the leverage when it is above the tier's floor", () => {
    const set = (floorBps: number | null, weekendBps: number) => leverageReason(ticketLimits(account(), 1, { floorBps, weekendBps }));
    expect(set(500, 750)).toBe(" Weekend margin applies here, which allows up to 20x leverage.");
    expect(set(500, 300)).toBe(" Volume tier 0 allows up to 20x leverage here.");
    expect(set(500, 0)).toBe(" Volume tier 0 allows up to 20x leverage here.");
    // With the tier table unread the floor is unknown, and a weekend margin that applies is what is named.
    expect(set(null, 750)).toContain("Weekend margin applies");
  });
});

describe("ticketLimits", () => {
  it("reads the market's best-price bound and leverage and the order count against the tier's limit", () => {
    expect(ticketLimits(account(0, 3), 1)).toEqual({ tier: 0, bestPriceBound: fixedFromInt(500_000), leverage: fixedFromInt(20), weekendSets: false, orderLimit: 25, resting: 3 });
    expect(ticketLimits(account(0), 2)).toMatchObject({ bestPriceBound: null, leverage: null });
  });

  it("is absent from a node that predates volume tiers", () => {
    expect(ticketLimits({ ...account(), volume: undefined }, 1)).toBeNull();
    expect(ticketLimits(null, 1)).toBeNull();
  });
});

describe("orderLimitProblem", () => {
  it("stops a resting order once the account rests its tier's limit, and names the tier", () => {
    expect(orderLimitProblem(ticketLimits(account(0, 25), 1), true)).toBe("You have 25 open orders, the most for volume tier 0. Cancel one to place another, or trade more to reach a higher tier.");
  });

  it("lets an order through while there is room, a market order at the limit, and a tier that names no limit", () => {
    expect(orderLimitProblem(ticketLimits(account(0, 24), 1), true)).toBeNull();
    expect(orderLimitProblem(ticketLimits(account(0, 25), 1), false)).toBeNull();
    const unnamed = { ...account(0, 30), volume: decodeVolume({ ...wire(0), max_resting_orders: undefined }) ?? undefined };
    expect(orderLimitProblem(ticketLimits(unnamed, 1), true)).toBeNull();
    expect(orderLimitProblem(null, true)).toBeNull();
  });
});

describe("leverageReason", () => {
  it("names the tier's leverage in a market, and nothing without it", () => {
    expect(leverageReason(ticketLimits(account(0), 1))).toBe(" Volume tier 0 allows up to 20x leverage here.");
    expect(leverageReason(ticketLimits(account(0), 2))).toBe("");
    expect(leverageReason(null)).toBe("");
  });
});

describe("accountPricing", () => {
  it("gives the console's own pricing the tier's margin floor and the account's first band", async () => {
    const view = (await btc()).view;
    const pricing = accountPricing(account(1), PARAMS, view);
    expect(pricing.marginFloorBps).toBe(200);
    expect(pricing.spreadTiers?.[0]).toMatchObject({ up_to: "1000000" });
    expect(accountPricing(account(0), null, view)).toEqual({});
  });
});

describe("words", () => {
  it("states the step to the next tier, with the volume left, the day cap and the fewest days", () => {
    const table = decodeTiers(TABLE) ?? [];
    const volume = decodeVolume({ ...wire(0), progress: [{ capped: "0", days: 0 }, { capped: "300000", days: 0 }, { capped: "0", days: 0 }] });
    const next = volume && nextTier(volume, table);
    expect(next && describeNextTier(next)).toBe("Tier 1 needs $700,000 more counted volume. Each day counts up to $500,000, so that takes at least 2 more days of trading.");
    expect(describeNextTier({ tier: 1, volumeLeft: 0n, dayCap: fixedFromInt(500_000), daysNeeded: 2, daysLeast: 0 })).toBe("Tier 1 needs trading on at least 2 days. Each day counts up to $500,000.");
    expect(describeNextTier({ tier: 1, volumeLeft: 1n, dayCap: fixedFromInt(500_000), daysNeeded: 2, daysLeast: 1 })).toContain("so that takes at least one more day of trading");
  });

  it("states a discount as a share and a boost as the multiple it weighs", () => {
    expect([0, 1_000, 2_000].map(describeDiscount)).toEqual(["None", "10%", "20%"]);
    expect([0, 1_000, 2_500, 5_000].map(describeBoost)).toEqual(["1x", "1.1x", "1.25x", "1.5x"]);
  });

  it("states a bound, a limit and a whole-dollar amount", () => {
    expect(describeBestPrice(fixedFromInt(500_000))).toBe("Up to $500,000");
    expect(describeBestPrice(null)).toBe("Any size");
    expect(describeLimit(25)).toBe("25");
    expect(describeLimit(null)).toBe("Standard");
    expect(usdWhole(q("1234.9"))).toBe("$1,234");
  });
});
