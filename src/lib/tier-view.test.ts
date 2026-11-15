/** Tests for what the console shows of the account's volume tier: the panel's standing and benefits, and the ticket's limits and refusals. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import type { HouseParams } from "./house";
import type { AccountModel } from "./models";
import { accountPricing, describeBestPrice, describeLimit, describeNextTier, leverageReason, orderLimitProblem, ticketLimits, tierBenefits, tierStanding, usdWhole } from "./tier-view";
import { decodeVolume, nextTier, decodeTiers } from "./volume-tier";
import { btc, q } from "./ticket-fixtures";

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
    const benefits = standing && tierBenefits(standing, market);
    expect(benefits?.now).toMatchObject({ bestPriceBound: fixedFromInt(500_000), leverage: fixedFromInt(20), maxRestingOrders: 25, requestsPerSecond: 2 });
    expect(benefits?.next).toMatchObject({ bestPriceBound: fixedFromInt(1_000_000), leverage: fixedFromInt(50), maxRestingOrders: 50, requestsPerSecond: 5 });
    const top = tierStanding(account(2), PARAMS);
    expect(top && tierBenefits(top, market)?.next).toBeNull();
  });

  it("has none while the table is unread", () => {
    const standing = tierStanding(account(), null);
    expect(standing && tierBenefits(standing, undefined)).toBeNull();
  });
});

describe("ticketLimits", () => {
  it("reads the market's best-price bound and leverage and the order count against the tier's limit", () => {
    expect(ticketLimits(account(0, 3), 1)).toEqual({ tier: 0, bestPriceBound: fixedFromInt(500_000), leverage: fixedFromInt(20), orderLimit: 25, resting: 3 });
    expect(ticketLimits(account(0), 2)).toMatchObject({ bestPriceBound: null, leverage: null });
  });

  it("is absent from a node that predates volume tiers", () => {
    expect(ticketLimits({ ...account(), volume: undefined }, 1)).toBeNull();
    expect(ticketLimits(null, 1)).toBeNull();
  });
});

describe("orderLimitProblem", () => {
  it("stops a resting order once the account rests its tier's limit, and names the tier", () => {
    expect(orderLimitProblem(ticketLimits(account(0, 25), 1), true)).toBe("You rest 25 orders, the most at volume tier 0. Cancel one to place another, or trade up a tier for a higher limit.");
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
    expect(leverageReason(ticketLimits(account(0), 1))).toBe(" Volume tier 0 allows up to 20x here.");
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
    expect(next && describeNextTier(next)).toBe("Tier 1 needs $700,000 more counted volume, over at least 2 more days at the day cap of $500,000 (2 days in all).");
    expect(describeNextTier({ tier: 1, volumeLeft: 0n, dayCap: fixedFromInt(500_000), daysNeeded: 2, daysLeast: 0 })).toBe("Tier 1 needs trading on at least 2 days, each counting up to $500,000.");
    expect(describeNextTier({ tier: 1, volumeLeft: 1n, dayCap: fixedFromInt(500_000), daysNeeded: 2, daysLeast: 1 })).toContain("over at least one more day");
  });

  it("states a bound, a limit and a whole-dollar amount", () => {
    expect(describeBestPrice(fixedFromInt(500_000))).toBe("Up to $500,000");
    expect(describeBestPrice(null)).toBe("Whole size");
    expect(describeLimit(25)).toBe("25");
    expect(describeLimit(null)).toBe("Node's default");
    expect(usdWhole(q("1234.9"))).toBe("$1,234");
  });
});
