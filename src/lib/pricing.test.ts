/** Tests for the engine's V52 pricing, against its own fill vectors (`crates/core/tests/fill_spreads.rs`), and the margin bands. */

import { describe, expect, it } from "vitest";

import { fixedFromInt, parseFixed, type Fixed } from "./fixed";
import type { MarketView, SpreadTier, Tier } from "./engine/types";
import { adverseBps, CALM, closing, conversionAt, exceedsSlippage, executionCost, growth, growthOf, paramsMissing, priceOrder, slicedBps, stressTermsAt, tierCost, tieredMargin, USD, type PricingInput } from "./pricing";

/** The engine harness's bands from V52: 1bp to $1m, 2bp to $5m and 5bp above, in tenths. */
const BANDS: SpreadTier[] = [{ up_to: "1000000", tenth_bps: 10 }, { up_to: "5000000", tenth_bps: 20 }, { up_to: null, tenth_bps: 50 }];
const MARGIN: Tier[] = [{ up_to: "100000", bps: 200 }, { up_to: null, bps: 500 }];
const MID = fixedFromInt(100_000);

const f = (text: string): Fixed => {
  const value = parseFixed(text);
  if (value === null) throw new Error(`bad fixture ${text}`);
  return value;
};
const units = fixedFromInt;

/** The price of `qty` units on `side` against `held`, at the engine harness's calm level with no ceiling, unless `extra` says otherwise. */
function price(side: "buy" | "sell", held: number, qty: string, extra: Partial<PricingInput> = {}): Fixed {
  const priced = priceOrder({ mid: MID, side, held: units(held), qty: f(qty), tiers: BANDS, stress: CALM, toxicityBps: 0, ceilingBps: null, conversion: USD, ...extra });
  if (priced.kind !== "priced") throw new Error(`refused: ${JSON.stringify(priced.reject)}`);
  return priced.price;
}

describe("priceOrder", () => {
  it("charges a round trip the bands on the open and again on the close", () => {
    // $2m pays 100 + 200 = 300, 15 a unit, each way.
    expect([price("buy", 0, "20"), price("sell", 20, "20")]).toEqual([f("100015"), f("99985")]);
  });

  it("charges partial closes each band they close through, rounded up per unit", () => {
    // Opening $12m pays 1m at 1bp, 4m at 2bp and 7m at 5bp: 4400 over 120 units, rounded up.
    expect(price("buy", 0, "120")).toBe(f("100036.666666667"));
    // 12m to 5m at 5bp; 5m to 2m at 2bp; 2m to 0.5m across two bands (200 + 50 over 15); the last 0.5m at 1bp.
    expect([price("sell", 120, "70"), price("sell", 50, "30"), price("sell", 20, "15"), price("sell", 5, "5")]).toEqual([f("99950"), f("99980"), f("99983.333333333"), f("99990")]);
  });

  it("charges a reversal its close through the bands and then its open, over the whole order", () => {
    // Closing $2m pays 300 and opening $1m short pays 100: 400 over 30 units, rounded up.
    expect(price("sell", 20, "30")).toBe(f("99986.666666666"));
  });

  it("scales the closing slice by the stress multiplier and adds the level's minimum", () => {
    // Level 1 doubles the $1m close's 100 to 200, 20 a unit, and adds its 5bp minimum.
    expect(price("sell", 10, "10", { stress: { minSpreadBps: 5, sizeMultiplierBps: 20_000 } })).toBe(f("99930"));
  });

  it("adds a toxicity add-on over the whole quantity", () => {
    expect(price("buy", 0, "1", { toxicityBps: 3 })).toBe(f("100040"));
  });

  it("clamps a pure close to its ceiling, refuses a reversal over it, and lets one under it pay its charge", () => {
    const wide = { stress: { minSpreadBps: 9_996, sizeMultiplierBps: 100_000 }, toxicityBps: 1, ceilingBps: 20 };
    // The charge reaches the price; clamped to 20bp, the close fills at the ceiling.
    expect(price("sell", 10, "4", wide)).toBe(f("99800"));
    expect(priceOrder({ mid: MID, side: "sell", held: units(10), qty: units(14), tiers: BANDS, conversion: USD, ...wide })).toEqual({ kind: "refused", reject: { kind: "close_spread_ceiling", ceiling_bps: 20 } });
    expect(price("sell", 10, "14", { ceilingBps: 20 })).toBe(f("99990"));
  });

  it("refuses an opening spread that reaches the price, and no close at its ceiling", () => {
    const wide = { mid: MID, side: "buy" as const, held: 0n, qty: units(1), tiers: BANDS, stress: { minSpreadBps: 10_000, sizeMultiplierBps: 10_000 }, toxicityBps: 0, conversion: USD };
    expect(priceOrder({ ...wide, ceilingBps: 20 })).toEqual({ kind: "refused", reject: { kind: "invalid_order", reason: "spread at this size reaches the price" } });
    expect(priceOrder({ ...wide, side: "sell", held: units(1), ceilingBps: null })).toEqual({ kind: "refused", reject: { kind: "invalid_order", reason: "spread at this size reaches the price" } });
  });

  it("charges an FX band in tenths of a bp, below one bp", () => {
    // EUR-USD's 0.4bp first band on $1.08m: 43.2 USD over 1m units.
    const eur = { mid: f("1.08"), held: 0n, qty: units(1_000_000), tiers: [{ up_to: "10000000", tenth_bps: 4 }, { up_to: null, tenth_bps: 8 }], stress: CALM, toxicityBps: 0, ceilingBps: 17, conversion: USD };
    expect(priceOrder({ ...eur, side: "buy" })).toEqual({ kind: "priced", price: f("1.0800432"), spread: f("0.0000432"), increases: true });
  });

  it("converts the bands' USD charge to the quote currency for a market quoted in euros", () => {
    const view = { id: 23, quote_currency: { currency: "eur", fx_market: 10 }, fx_mark: "1.25" } as MarketView;
    const conversion = conversionAt(view, f("20000"));
    if (conversion === null) throw new Error("no conversion");
    // $250k at 1bp is 25 USD, 20 EUR, over 10 units.
    expect(price("buy", 0, "10", { mid: f("20000"), tiers: [{ up_to: null, tenth_bps: 10 }], conversion })).toBe(f("20002"));
    expect(conversionAt({ ...view, fx_mark: null }, f("20000"))).toBeNull();
  });
});

describe("growth and closing", () => {
  it("split an order into the slice that grows the position and the slice that closes it", () => {
    const cases: [number, number, [number, number], [number, number]][] = [
      [10, 5, [10, 15], [0, 0]], [10, -4, [0, 0], [6, 10]], [10, -13, [0, 3], [0, 10]], [10, -10, [0, 0], [0, 10]], [0, -2, [0, 2], [0, 0]],
    ];
    for (const [held, delta, grows, closes] of cases) {
      expect([growth(units(held), units(delta)), closing(units(held), units(delta))], `${held} ${delta}`).toEqual([grows.map(units), closes.map(units)]);
    }
    expect([growthOf(units(10), units(-4)), growthOf(units(10), units(-13))]).toEqual([{ grows: false }, { grows: true }]);
  });
});

describe("margin bands", () => {
  it("apply each band to the slice inside it, exactly, and weight a slice that crosses bands", () => {
    expect(tieredMargin(MARGIN, fixedFromInt(110_000))).toBe(fixedFromInt(2_500));
    expect(tieredMargin(MARGIN, fixedFromInt(-200_000))).toBe(fixedFromInt(7_000));
    expect(tierCost(MARGIN, 0n, fixedFromInt(110_000))).toBe(fixedFromInt(2_500));
    expect(slicedBps(MARGIN, 0n, fixedFromInt(200_000))).toBe(350);
  });
});

describe("adverseBps and exceedsSlippage", () => {
  it("count only a worse live price, compared exactly", () => {
    expect([adverseBps("buy", units(100), units(101)), adverseBps("buy", units(100), units(99)), adverseBps("sell", units(100), units(99))]).toEqual([100, 0, 100]);
    const quoted = units(10_000);
    expect(exceedsSlippage("buy", quoted, quoted + (quoted * 209n) / 10_000n / 10n, 20)).toBe(true);
    expect(exceedsSlippage("buy", quoted, quoted + (quoted * 20n) / 10_000n, 20)).toBe(false);
  });
});

describe("executionCost", () => {
  const index = units(100);
  it("charges the profit fee at the given rate on a partial reduction, an exact close and a reversal, but not on a loss or an add", () => {
    const fee = (held: number, delta: number, feeBps: number) => executionCost({ held: units(held), delta: units(delta), entry: units(80), price: units(100), index, feeBps });
    expect(fee(10, -4, 1_000)).toBe(units(8)); // 4 units close at +20: a tenth of 80
    expect([fee(10, -10, 1_000), fee(10, -13, 1_000), fee(10, -10, 10_000)]).toEqual([units(20), units(20), units(200)]);
    expect(fee(10, 5, 1_000)).toBe(0n);
    expect(executionCost({ held: units(10), delta: units(-4), entry: units(120), price: units(100), index, feeBps: 10_000 })).toBe(0n);
  });
});

describe("the stress level's terms", () => {
  it("come from the node's levels when it lists the market's level, and say why they are missing after a failed or absent read", () => {
    const levels = [{ size_spread_multiplier_bps: 10_000, min_spread_bps: 0 }, { size_spread_multiplier_bps: 20_000, min_spread_bps: 2 }];
    expect([stressTermsAt(levels, 1), stressTermsAt(levels, 2), stressTermsAt(undefined, 0)]).toEqual([{ minSpreadBps: 2, sizeMultiplierBps: 20_000 }, undefined, undefined]);
    expect([paramsMissing("pending"), paramsMissing("read"), paramsMissing("unavailable"), paramsMissing("failed")]).toEqual([null, null, "This node does not serve its parameters.", "The node's parameters could not be read; the console reads them again by itself."]);
  });
});
