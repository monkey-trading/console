/** Tests for the levels' rules as the engine's V79 holds them: the side and distance a level must keep, what a change measures, and a level's result. */

import { describe, expect, it } from "vitest";

import type { LevelKind, MarketView } from "./engine/types";
import { fixedFromInt, parseFixed, type Fixed } from "./fixed";
import { checkLevel, decodeLevels, formatLevel, levelsWire, minLevelDistance, movedLevels, offeredLevelDistance, parseLevel, resultAtLevel } from "./levels";

const f = (text: string): Fixed => parseFixed(text) ?? 0n;
const REF = fixedFromInt(100_000);

describe("checkLevel", () => {
  // 30 bps of 100,000 is 300: a long's take profit from 100,300, its stop loss to 99,700, and the other way for a short.
  const cases: [string, LevelKind, boolean, string, "wrong_side" | "too_close" | null][] = [
    ["a long's take profit at the bound", "take_profit", true, "100300", null],
    ["a long's take profit a billionth short of it", "take_profit", true, "100299.999999999", "too_close"],
    ["a long's take profit at the reference", "take_profit", true, "100000", "too_close"],
    ["a long's take profit below the reference", "take_profit", true, "99999", "wrong_side"],
    ["a long's stop loss at the bound", "stop_loss", true, "99700", null],
    ["a long's stop loss inside it", "stop_loss", true, "99800", "too_close"],
    ["a long's stop loss above the reference", "stop_loss", true, "100001", "wrong_side"],
    ["a short's take profit at the bound", "take_profit", false, "99700", null],
    ["a short's take profit above the reference", "take_profit", false, "100100", "wrong_side"],
    ["a short's stop loss at the bound", "stop_loss", false, "100300", null],
    ["a short's stop loss inside it", "stop_loss", false, "100200", "too_close"],
    ["a short's stop loss below the reference", "stop_loss", false, "99000", "wrong_side"],
  ];
  it.each(cases)("judges %s", (_, kind, long, level, why) => {
    const refused = checkLevel(kind, f(level), long, REF, 30);
    expect(refused === null ? null : refused.why).toBe(why);
  });

  it("names the nearest level accepted, the distance rounded up as the engine rounds it", () => {
    // 30 bps of 99,980.123456789 is 299.9403703703667, which the engine rounds up to 299.940370371.
    const reference = f("99980.123456789");
    const refused = checkLevel("take_profit", f("100000"), true, reference, 30);
    expect(refused).toEqual({ kind: "take_profit", why: "too_close", level: f("100000"), bound: f("100280.063827160"), reference, minDistanceBps: 30 });
    // At the bound a take profit passes, and a billionth inside it is refused; a stop loss's bound rounds away below.
    expect(checkLevel("take_profit", f("100280.063827160"), true, reference, 30)).toBeNull();
    expect(checkLevel("take_profit", f("100280.063827159"), true, reference, 30)?.why).toBe("too_close");
    expect(checkLevel("stop_loss", f("99680.183086418"), true, reference, 30)).toBeNull();
    expect(checkLevel("stop_loss", f("99680.183086419"), true, reference, 30)?.why).toBe("too_close");
  });
});

describe("movedLevels", () => {
  it("keeps only the levels a change sets anew or moves, as the engine measures them", () => {
    const held = { takeProfit: fixedFromInt(110), stopLoss: fixedFromInt(90) };
    expect(movedLevels({ takeProfit: fixedFromInt(110), stopLoss: fixedFromInt(95) }, held)).toEqual({ takeProfit: null, stopLoss: fixedFromInt(95) });
    expect(movedLevels({ takeProfit: fixedFromInt(120), stopLoss: fixedFromInt(90) }, held)).toEqual({ takeProfit: fixedFromInt(120), stopLoss: null });
    expect(movedLevels({ takeProfit: null, stopLoss: null }, held)).toEqual({ takeProfit: null, stopLoss: null });
    expect(movedLevels(held, { takeProfit: null, stopLoss: null })).toEqual(held);
  });
});

describe("parseLevel", () => {
  it("reads a level exactly as typed, empty as none, and refuses anything else with the reason", () => {
    expect(parseLevel(" ", "take profit")).toEqual({ kind: "empty" });
    expect(parseLevel("97500.5", "stop loss")).toEqual({ kind: "level", level: f("97500.5") });
    expect(parseLevel("97,500", "stop loss")).toEqual({ kind: "refused", message: "Enter the stop loss in digits, such as 61250.50." });
    expect(parseLevel("0", "take profit")).toEqual({ kind: "refused", message: "Enter a take profit above zero." });
    expect(parseLevel("1000000001", "take profit")).toEqual({ kind: "refused", message: "The take profit is above the highest price the server accepts." });
    expect(parseLevel("1000000000", "take profit")).toEqual({ kind: "level", level: fixedFromInt(1_000_000_000) });
  });
});

describe("the wire", () => {
  it("decodes the account read's levels, a malformed one as absent, and writes each set level back", () => {
    expect(decodeLevels({ take_profit: "105000", stop_loss: "nope" })).toEqual({ takeProfit: fixedFromInt(105_000), stopLoss: null });
    expect(decodeLevels(undefined)).toEqual({ takeProfit: null, stopLoss: null });
    expect(levelsWire({ takeProfit: null, stopLoss: f("97500.5") })).toEqual({ stop_loss: "97500.5" });
  });

  it("takes a market's distance only from a positive whole number, as every V79 listing names one", () => {
    const view = (bps?: number) => ({ min_level_distance_bps: bps }) as unknown as MarketView; // only the field read here
    expect([view(30), view(undefined), view(0), view(1.5)].map(minLevelDistance)).toEqual([30, null, null, null]);
  });

  it("offers a listed distance only once the node runs V79, as a listing may name one before the activation that takes it up", () => {
    const view = (bps?: number) => ({ min_level_distance_bps: bps }) as unknown as MarketView; // only the field read here
    expect([null, 78, 79, 80].map((version) => offeredLevelDistance(view(30), version))).toEqual([null, null, 30, 30]);
    expect(offeredLevelDistance(view(undefined), 79)).toBeNull();
  });
});

describe("formatLevel", () => {
  it("shows a level at the market's places, keeping any finer digit it was set with", () => {
    expect(formatLevel(f("97500.5"), 2)).toBe("97,500.50");
    expect(formatLevel(f("97500.555"), 2)).toBe("97,500.555");
    expect(formatLevel(f("1.0825"), 5)).toBe("1.08250");
  });
});

describe("resultAtLevel", () => {
  it("gives what closing at the level realises before the fee, rounded down as the engine books it", () => {
    const usd = (x: Fixed) => x;
    // 0.3 x 10.000000001 is 3.0000000003, a fraction of a billionth that rounds down.
    expect(resultAtLevel(true, fixedFromInt(100), f("0.3"), f("110.000000001"), usd)).toBe(fixedFromInt(3));
    expect(resultAtLevel(false, fixedFromInt(100), f("-0.5"), fixedFromInt(90), usd)).toBe(fixedFromInt(5));
    expect(resultAtLevel(true, fixedFromInt(100), fixedFromInt(1), fixedFromInt(95), usd)).toBe(fixedFromInt(-5));
  });
});
