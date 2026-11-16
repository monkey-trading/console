/** Tests for how the holding-time fee reads on screen. */

import { describe, expect, it } from "vitest";

import { describeNextFall, describeNextFallShort, describeSchedule, formatCurveHold, formatHold, positionFee } from "./fee-words";
import { LAUNCH_CURVE } from "./holding-fee";

const TERMS = { profitFeeBps: 1_000, profitFeeCurve: LAUNCH_CURVE };
const OPENED = 1_000_000;

describe("formatHold", () => {
  it("truncates to whole seconds, minutes, hours and days", () => {
    expect([formatHold(-5), formatHold(8_999), formatHold(65_000), formatHold(899_999), formatHold(7_380_000), formatHold(273_600_000)]).toEqual(["0s", "8s", "1m 05s", "14m 59s", "2h 03m", "3d 04h"]);
  });
});

describe("formatCurveHold", () => {
  it("names a point's hold to the millisecond", () => {
    expect([formatCurveHold(10_000), formatCurveHold(15_683), formatCurveHold(60_492), formatCurveHold(233_330), formatCurveHold(900_000)]).toEqual(["10 s", "15.683 s", "1 min 0.492 s", "3 min 53.33 s", "15 min"]);
  });
});

describe("positionFee", () => {
  const served = { openedAt: OPENED, feeBps: 9_999, fallsAt: OPENED + 10_013 };

  it("runs the hold clock from the open time under the node's curve, so the rate falls with the clock", () => {
    expect(positionFee(served, TERMS, OPENED + 60_000)).toEqual({ holdMs: 60_000, feeBps: 6_421, fallsAt: OPENED + 60_005, baseAt: OPENED + 900_000 });
  });

  it("takes the account read's rate and fall without a curve, and nothing without a close fee", () => {
    expect(positionFee(served, null, OPENED + 10_008)).toEqual({ holdMs: 10_008, feeBps: 9_999, fallsAt: OPENED + 10_013, baseAt: null });
    expect(positionFee(served, { profitFeeBps: 1_000, profitFeeCurve: [] }, OPENED)).toEqual({ holdMs: 0, feeBps: 9_999, fallsAt: OPENED + 10_013, baseAt: null });
    expect(positionFee(null, TERMS, OPENED)).toBeNull();
  });
});

describe("describeNextFall", () => {
  it("counts down while the rate holds, names the base while it falls, and says when it is the base", () => {
    const fee = (now: number) => positionFee({ openedAt: OPENED, feeBps: 0, fallsAt: null }, TERMS, now);
    const at = (now: number) => {
      const found = fee(now);
      if (found === null) throw new Error("no fee");
      return describeNextFall(found, 1_000, now);
    };
    expect([at(OPENED + 4_000), at(OPENED + 9_500), at(OPENED + 60_000), at(OPENED + 900_000)]).toEqual(["Falls in 6s", "Falling to 10.00% in 14m 50s", "Falling to 10.00% in 14m 00s", "Base rate"]);
    expect(describeNextFall({ holdMs: 60_000, feeBps: 6_421, fallsAt: OPENED + 60_005, baseAt: null }, null, OPENED + 60_000)).toBe("Falling");
  });
});

describe("describeNextFallShort", () => {
  it("names the base's time in at most 16 characters, and agrees with the sentence where it has nothing shorter", () => {
    const fee = (now: number) => positionFee({ openedAt: OPENED, feeBps: 0, fallsAt: null }, TERMS, now);
    const at = (now: number) => {
      const found = fee(now);
      if (found === null) throw new Error("no fee");
      return describeNextFallShort(found, 1_000, now);
    };
    const shown = [at(OPENED + 4_000), at(OPENED + 9_500), at(OPENED + 60_000), at(OPENED + 900_000)];
    expect(shown).toEqual(["Falls in 6s", "Base in 14m 50s", "Base in 14m 00s", "Base rate"]);
    for (const text of shown) expect(text.length).toBeLessThanOrEqual(16);
    expect(describeNextFallShort({ holdMs: 60_000, feeBps: 6_421, fallsAt: OPENED + 60_005, baseAt: null }, null, OPENED + 60_000)).toBe("Falling");
    expect(describeNextFallShort({ holdMs: 0, feeBps: 6_421, fallsAt: OPENED + 29 * 86_400_000 + 23 * 3_600_000, baseAt: null }, 1_000, OPENED)).toBe("Falls in 29d 23h");
  });
});

describe("describeSchedule", () => {
  it("states the fee on a new position, the lowest fee and the hold it applies from in spoken units, or one rate when the fee never falls", () => {
    expect(describeSchedule(TERMS)).toBe("The fee decays over time, starting at 100% on a newly opened position and falling to 10% for positions held for 15 minutes or more.");
    expect(describeSchedule({ profitFeeBps: 1_500, profitFeeCurve: LAUNCH_CURVE })).toBe("The fee decays over time, starting at 100% on a newly opened position and falling to 15% for positions held for 11 minutes 59 seconds or more.");
    expect(describeSchedule({ profitFeeBps: 925, profitFeeCurve: [{ hold_ms: 1_000, fee_bps: 5_050 }, { hold_ms: 3_600_000, fee_bps: 925 }] })).toBe("The fee decays over time, starting at 50.5% on a newly opened position and falling to 9.25% for positions held for 1 hour or more.");
    expect(describeSchedule({ profitFeeBps: 6_000, profitFeeCurve: [{ hold_ms: 1_000, fee_bps: 6_000 }, { hold_ms: 61_000, fee_bps: 1_000 }] })).toBe("The fee is 60% of the profit, regardless of how long the position is held.");
    expect(describeSchedule({ profitFeeBps: 1_000, profitFeeCurve: [] })).toBe("The fee is 10% of the profit, regardless of how long the position is held.");
  });
});
