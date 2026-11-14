/** Tests for the preview of a close: realised result, fee and what the account keeps, exact or a bound. */

import { describe, expect, it } from "vitest";

import { ladderSlack, previewClose, RATE_HOLD_MS, ticketClose, type CloseOrder } from "./close-preview";
import type { SpreadTier } from "./engine/types";
import { CALM, priceOrder, USD } from "./pricing";
import { mulberry32 } from "./prng";
import { fixedFromInt, parseFixed, type Fixed } from "./fixed";
import { mulRounded } from "./fixed-rounding";

const f = (text: string): Fixed => {
  const value = parseFixed(text);
  if (value === null) throw new Error(`bad fixture ${text}`);
  return value;
};
const NOW = 1_000_000;
const LONG: CloseOrder = { held: fixedFromInt(2), entry: f("100000"), side: "sell", qty: fixedFromInt(2), price: f("100100"), exactPrice: true, feeBps: 1_000, fallsAt: null, now: NOW, toUsdDown: (amount) => amount };

describe("previewClose", () => {
  it("closes a whole long at its quote: the gain, a tenth of it as the fee, and the rest kept, exactly", () => {
    expect(previewClose(LONG)).toEqual({ closed: fixedFromInt(2), whole: true, reverses: false, price: f("100100"), realised: f("200"), feeBps: 1_000, fee: f("20"), net: f("180"), exact: true });
  });

  it("rounds a short's realised result down and its fee up, as the engine books them", () => {
    // A short of 3 at 10.000000001 closed at 10: a gain of 3 raw units; at 3333 bps the fee is 0.9999 of a unit, rounded up to 1.
    const short = previewClose({ ...LONG, held: fixedFromInt(-3), entry: f("10.000000001"), side: "buy", qty: fixedFromInt(3), price: f("10"), feeBps: 3_333 });
    expect([short?.realised, short?.fee, short?.net]).toEqual([3n, 1n, 2n]);
    // A loss on a third of a unit rounds down, away from zero, and pays no fee.
    const loss = previewClose({ ...LONG, entry: f("100000.000000001"), qty: f("0.333333333"), price: f("100000") });
    expect([loss?.realised, loss?.fee, loss?.net]).toEqual([-1n, 0n, -1n]);
  });

  it("closes only the order's size of a larger position, and the whole position of a reversal", () => {
    const part = previewClose({ ...LONG, qty: fixedFromInt(1) });
    expect([part?.closed, part?.whole, part?.reverses, part?.realised]).toEqual([fixedFromInt(1), false, false, f("100")]);
    const reversal = previewClose({ ...LONG, qty: fixedFromInt(5) });
    expect([reversal?.closed, reversal?.whole, reversal?.reverses, reversal?.realised]).toEqual([fixedFromInt(2), false, true, f("200")]);
  });

  it("takes all of a gain at the full fee, so nothing is kept", () => {
    expect(previewClose({ ...LONG, feeBps: 10_000 })?.net).toBe(0n);
  });

  it("converts the result to USD through the market's conversion, rounded down", () => {
    const toUsd = (amount: Fixed) => mulRounded(amount, f("1.1"), "down");
    expect(previewClose({ ...LONG, toUsdDown: toUsd })?.realised).toBe(f("220"));
  });

  it("is a bound when the price is a ladder step, or the rate falls within a second", () => {
    expect(previewClose({ ...LONG, exactPrice: false })?.exact).toBe(false);
    expect(previewClose({ ...LONG, fallsAt: NOW + RATE_HOLD_MS - 1 })?.exact).toBe(false);
    expect(previewClose({ ...LONG, fallsAt: NOW + RATE_HOLD_MS })?.exact).toBe(true);
  });

  it("previews nothing for an order on the position's own side or with no position", () => {
    expect(previewClose({ ...LONG, side: "buy" })).toBeNull();
    expect(previewClose({ ...LONG, held: 0n })).toBeNull();
  });
});

describe("ticketClose", () => {
  const input = { position: { qty: fixedFromInt(2), entry: f("100000") }, side: "sell" as const, qty: fixedFromInt(1), price: f("100100"), exactPrice: false, feeBps: 10_000, fallsAt: NOW + 6_000, now: NOW, toUsdDown: (amount: Fixed) => amount };

  it("previews an order that closes part of a position as a bound", () => {
    expect(ticketClose(input)).toEqual({ closed: fixedFromInt(1), whole: false, reverses: false, price: f("100100"), realised: f("100"), feeBps: 10_000, fee: f("100"), net: 0n, exact: false });
  });

  it("previews nothing without a position, a price, a rate, an FX price or a size", () => {
    for (const missing of [{ position: null }, { price: null }, { feeBps: null }, { toUsdDown: null }, { qty: 0n }]) expect(ticketClose({ ...input, ...missing })).toBeNull();
  });
});

describe("ladderSlack", () => {
  it("is a raw unit of cost per rounding, spread over the size and rounded up, plus the division's own unit", () => {
    // The dev scenario's BTC-USD half close: 0.29964 BTC through three bands, which filled 4 raw units under its step.
    expect(ladderSlack(f("0.29964"), 3)).toBe(28n);
    expect([ladderSlack(fixedFromInt(1), 3), ladderSlack(fixedFromInt(1_000_000), 3)]).toEqual([9n, 2n]);
  });

  it("covers every smaller close's price against the step that covers it, through bands, multipliers and mids with odd decimals", () => {
    const tiers: SpreadTier[] = [{ up_to: "2000000", tenth_bps: 20 }, { up_to: "10000000", tenth_bps: 40 }, { up_to: null, tenth_bps: 80 }];
    const rand = mulberry32(0x5ac);
    for (let i = 0; i < 500; i += 1) {
      // A long, a covering step inside its top band, and a smaller close: the step's average is no better than the close's but for rounding.
      const mid = fixedFromInt(90_000) + BigInt(Math.floor(rand() * 1e9)) * 20_000n + BigInt(Math.floor(rand() * 1e9));
      const held = fixedFromInt(1) + BigInt(Math.floor(rand() * 1e9)) * 15n;
      const step = BigInt(Math.floor(rand() * Number(held))) + 1n;
      const qty = BigInt(Math.floor(rand() * Number(step))) + 1n;
      const stress = rand() < 0.5 ? CALM : { minSpreadBps: 2, sizeMultiplierBps: 20_000 };
      const sell = (size: bigint) => priceOrder({ mid, side: "sell", held, qty: size, tiers, stress, toxicityBps: 0, ceilingBps: null, conversion: USD });
      const [order, cover] = [sell(qty), sell(step)];
      if (order.kind !== "priced" || cover.kind !== "priced") throw new Error("refused");
      expect(order.price, `mid ${mid} held ${held} step ${step} qty ${qty}`).toBeGreaterThanOrEqual(cover.price - ladderSlack(qty, tiers.length));
    }
  });
});
