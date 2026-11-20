/** Tests for reading portfolio margin: the account read's groups, which earn an offset, and which orders change one. */

import { describe, expect, it } from "vitest";

import type { PortfolioGridWire, PortfolioMarginWire } from "./engine/portfolio-types";
import { fixedFromInt, parseFixed } from "./fixed";
import { creditedGroupOf, creditedGroups, decodePortfolio, totalOffset, touchesOffset, type CreditTerms } from "./portfolio";

/** The engine's worked example (`a_hedged_pair_takes_its_matched_exposures_credit`): oil and gold hedged, BTC alone. */
const COMMODITIES = { members: [32, 30], net_notional: "70000", matched_notional: "1260000", worst_loss: "2660", binding_direction: "down", offset: "3990" } as const;
const CRYPTO = { members: [1], net_notional: "-100000", matched_notional: "0", worst_loss: "0", binding_direction: "up", offset: "0" } as const;
const WIRE: PortfolioMarginWire = { margin: "20010", initial_margin: "33450", maintenance_margin: "10005", groups: { commodities: { ...COMMODITIES, members: [32, 30] }, crypto: { ...CRYPTO, members: [1] } } };

describe("decodePortfolio", () => {
  it("reads every figure and group, a short net negative", () => {
    expect(decodePortfolio(WIRE)).toEqual({
      margin: fixedFromInt(20_010), initialMargin: fixedFromInt(33_450), maintenanceMargin: fixedFromInt(10_005),
      groups: [
        { name: "commodities", members: [32, 30], netNotional: fixedFromInt(70_000), matchedNotional: fixedFromInt(1_260_000), offset: fixedFromInt(3_990) },
        { name: "crypto", members: [1], netNotional: fixedFromInt(-100_000), matchedNotional: 0n, offset: 0n },
      ],
    });
  });

  it("is absent with no grid, and refuses a malformed figure or member rather than guess", () => {
    expect(decodePortfolio(undefined)).toBeUndefined();
    expect(decodePortfolio({ ...WIRE, maintenance_margin: "lots" })).toBeUndefined();
    expect(decodePortfolio({ ...WIRE, groups: { x: { ...CRYPTO, members: [1], offset: "" } } })).toBeUndefined();
    expect(decodePortfolio({ ...WIRE, groups: { x: { ...CRYPTO, members: [1.5] } } })).toBeUndefined();
  });
});

describe("the groups that earn an offset", () => {
  it("counts only a group of two or more held markets with a credit, and sums their credits", () => {
    const portfolio = decodePortfolio(WIRE);
    expect(creditedGroups(portfolio).map((g) => g.name)).toEqual(["commodities"]);
    expect(totalOffset(portfolio)).toBe(fixedFromInt(3_990));
    expect([creditedGroupOf(portfolio, 30)?.name, creditedGroupOf(portfolio, 1)]).toEqual(["commodities", null]);
  });

  it("finds none for an account with no portfolio read, or whose matched exposure takes no credit", () => {
    expect(creditedGroups(undefined)).toEqual([]);
    expect(totalOffset(decodePortfolio({ ...WIRE, groups: { a: { ...COMMODITIES, members: [32, 30], offset: "0" } } }))).toBe(0n);
  });
});

/** BTC-USD (1) loading 1 and ETH-USD (2) loading 1.25, at 100,000 and 4,000; EUR-USD (3) in no group. */
const GRID: PortfolioGridWire = { groups: [{ name: "crypto", floor_share_bps: 5_000, max_floor_share_bps: 10_000, members: [{ market: 1, loading: "1", residual_shock_bps: 20, max_residual_shock_bps: 80 }, { market: 2, loading: "1.25", residual_shock_bps: 20, max_residual_shock_bps: 80 }] }] };
const MARKS = new Map([[1, fixedFromInt(100_000)], [2, fixedFromInt(4_000)], [3, fixedFromInt(1)]]);
const f = (text: string) => parseFixed(text) ?? 0n;
const touches = (held: [number, string][], market: number, delta: string, marks = MARKS) =>
  touchesOffset({ portfolio: undefined, grid: GRID, positions: held.map(([m, qty]) => ({ market: m, qty: f(qty) })), markOf: (id) => marks.get(id) ?? null, market, delta: f(delta) });

describe("which orders change a hedge", () => {
  it("finds an order that creates, grows, shrinks or removes the matched exposure", () => {
    // 1 BTC long is $100,000; 10 ETH short at 1.25 is $50,000 of loading-weighted exposure.
    expect(touches([[1, "1"]], 2, "-10")).toBe(true);
    expect(touches([[1, "1"], [2, "-10"]], 2, "-5")).toBe(true);
    expect(touches([[1, "1"], [2, "-10"]], 2, "10")).toBe(true);
    expect(touches([[1, "1"], [2, "-30"]], 1, "-1")).toBe(true);
  });

  it("passes over an order that matches nothing before or after: a lone position, the same side, or no group", () => {
    expect(touches([[1, "1"]], 1, "1")).toBe(false);
    expect(touches([[1, "1"]], 2, "10")).toBe(false);
    expect(touches([[1, "1"]], 3, "-1000")).toBe(false);
    expect(touches([], 1, "-1")).toBe(false);
  });

  it("passes over adding to a hedge's larger side, which matches no more, unless the account earns a credit there", () => {
    expect(touches([[1, "1"], [2, "-10"]], 1, "1")).toBe(false);
    const credited = decodePortfolio({ ...WIRE, groups: { crypto: { ...COMMODITIES, members: [1, 2] } } });
    expect(touchesOffset({ portfolio: credited, grid: GRID, positions: [], markOf: () => null, market: 1, delta: f("1") })).toBe(true);
  });

  it("cannot tell, and so passes over, a group whose held market has no mark or no grid", () => {
    expect(touches([[1, "1"]], 2, "-10", new Map([[1, fixedFromInt(100_000)]]))).toBe(false);
    expect(touchesOffset({ portfolio: undefined, grid: undefined, positions: [{ market: 1, qty: f("1") }], markOf: (id) => MARKS.get(id) ?? null, market: 2, delta: f("-10") })).toBe(false);
  });
});

/** Gold (30) and silver (32), each at loading 1, with residual shocks `gold` and `silver` bps: a group's launch shocks, or its bounds. */
const metals = (gold: number, silver: number): PortfolioGridWire => ({ groups: [{ name: "metals", floor_share_bps: 1_000, max_floor_share_bps: 10_000, members: [{ market: 30, loading: "1", residual_shock_bps: gold, max_residual_shock_bps: 167 }, { market: 32, loading: "1", residual_shock_bps: silver, max_residual_shock_bps: 73 }] }] });
const METAL_MARKS = new Map([[30, fixedFromInt(2_000)], [32, fixedFromInt(25)]]);
const TIERS = [{ up_to: "1000000", bps: 100 }, { up_to: null, bps: 200 }];

describe("which matched orders earn a credit", () => {
  /** A tier 2 account holding 100 oz of gold long, preparing 4,000 oz of silver short: $200,000 against $100,000. */
  const silverShort = (grid: PortfolioGridWire, initialFloorBps: number, bandsOf?: CreditTerms["bandsOf"]) =>
    touchesOffset({ portfolio: undefined, grid, positions: [{ market: 30, qty: f("100") }], markOf: (id) => METAL_MARKS.get(id) ?? null, market: 32, delta: f("-4000"), terms: { levelBps: 5_000, bandsOf: bandsOf ?? (() => ({ tiers: TIERS, initialFloorBps })) } });

  it("passes over an order whose group's grid charge meets its matched bands at both bases", () => {
    // At the bounds the charge is 2.4% of the matched notional against bands of 2%, before any close cost.
    expect(silverShort(metals(167, 73), 0)).toBe(false);
  });

  it("keeps an order whose group earns a credit at either basis", () => {
    expect(silverShort(metals(20, 20), 0)).toBe(true);
    // Initial bands that carry a floor can earn the credit the market's bands do not.
    expect(silverShort(metals(167, 73), 500)).toBe(true);
  });

  it("keeps an order it cannot value, which the server must tell", () => {
    expect(silverShort(metals(167, 73), 0, (market) => (market === 32 ? null : { tiers: TIERS, initialFloorBps: 0 }))).toBe(true);
  });
});
