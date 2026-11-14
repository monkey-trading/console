/** Tests for how the holding-time fee reads on screen. */

import { describe, expect, it } from "vitest";

import { describeNextFall, describeSchedule, formatCurveHold, formatHold, positionFee } from "./fee-words";
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

describe("describeSchedule", () => {
  it("states the full fee's hold and where the base takes over, or the one rate with no curve", () => {
    expect(describeSchedule(TERMS)).toBe("A realised gain pays 100.00% on a close within 10 s of the position's open, falling with the hold to 10.00% from 15 min on.");
    expect(describeSchedule({ profitFeeBps: 1_500, profitFeeCurve: LAUNCH_CURVE })).toBe("A realised gain pays 100.00% on a close within 10 s of the position's open, falling with the hold to 15.00% from 11 min 58.821 s on.");
    expect(describeSchedule({ profitFeeBps: 1_000, profitFeeCurve: [] })).toBe("A realised gain pays 10.00%, however long the position was held.");
  });
});
