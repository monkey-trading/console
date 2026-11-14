/** Tests for the holding-time profit fee, against the engine's own vectors (`crates/core/src/holding_fee/tests.rs`). */

import { describe, expect, it } from "vitest";

import type { CurvePoint } from "./engine/types";
import { fixedFromInt, parseFixed } from "./fixed";
import { baseFrom, curveFeeBps, feeAt, feeNow, LAUNCH_CURVE, lastHold, nextFall, openedAfter, profitFee } from "./holding-fee";
import { mulberry32 } from "./prng";

const CURVE = LAUNCH_CURVE;

/** Curves of up to six points over the first two seconds, so every millisecond can be walked, as the engine's property test draws them. */
function curves(seed: number, count: number): CurvePoint[][] {
  const rand = mulberry32(seed);
  const int = (low: number, high: number) => low + Math.floor(rand() * (high - low + 1));
  return Array.from({ length: count }, () => {
    let hold = 0;
    let fee = 10_000;
    return Array.from({ length: int(0, 6) }, () => {
      hold += int(1, 300);
      fee = Math.max(fee - int(0, 2_000), 0);
      return { hold_ms: hold, fee_bps: fee };
    });
  });
}

describe("feeAt", () => {
  it("holds the full fee to ten seconds, falls along the curve rounded up to the bp, and reaches the base at fifteen minutes", () => {
    const cases: [number, number][] = [
      [0, 10_000], [10_000, 10_000], [10_006, 10_000], [10_007, 9_999], [15_683, 9_100], [60_000, 6_421],
      [600_000, 1_828], [899_999, 1_001], [900_000, 1_000], [1_800_000, 1_000],
    ];
    expect(cases.map(([hold]) => [hold, feeAt(1_000, CURVE, hold)])).toEqual(cases);
    expect(curveFeeBps(CURVE, 900_000)).toBe(0);
  });

  it("charges a one-point curve's fee up to its hold, and an empty curve nothing past the base", () => {
    const one = [{ hold_ms: 5_000, fee_bps: 3_000 }];
    expect([curveFeeBps(one, 4_999), curveFeeBps(one, 5_000)]).toEqual([3_000, 0]);
    expect(nextFall(1_000, one, 0)).toBe(5_000);
    expect([feeAt(1_000, [], 0), nextFall(1_000, [], 0), lastHold([])]).toEqual([1_000, null, 0]);
  });
});

describe("nextFall", () => {
  it("never lets the fee rise with the hold, and names the first hold at which it drops", () => {
    for (const [index, curve] of curves(0x5eed_0053, 400).entries()) {
      const base = (index * 37) % 1_501;
      const end = lastHold(curve) + 2;
      const fees = Array.from({ length: end + 1 }, (_, hold) => feeAt(base, curve, hold));
      // Walking back from the end, the next fall from each hold is the first hold after it at which the fee changed.
      let fall: number | null = null;
      for (let hold = end; hold >= 0; hold -= 1) {
        expect(nextFall(base, curve, hold), `curve ${index} at ${hold}`).toBe(fall);
        if (hold > 0 && (fees[hold] ?? 0) < (fees[hold - 1] ?? 0)) fall = hold;
        if (hold > 0) expect(fees[hold] ?? 0).toBeLessThanOrEqual(fees[hold - 1] ?? 0);
      }
    }
  });

  it("names the first fall on the default curve a few milliseconds after its flat ten seconds", () => {
    expect([nextFall(1_000, CURVE, 0), nextFall(1_000, CURVE, 10_007), nextFall(1_000, CURVE, 899_999), nextFall(1_000, CURVE, 900_000)]).toEqual([10_007, 10_013, 900_000, null]);
  });
});

describe("baseFrom", () => {
  it("is the least hold from which the fee is the base, on every drawn curve and base", () => {
    for (const [index, curve] of curves(0xba5e, 400).entries()) {
      const base = (index * 53) % 1_501;
      const end = lastHold(curve) + 1;
      const first = Array.from({ length: end + 1 }, (_, hold) => hold).find((hold) => feeAt(base, curve, hold) === base && nextFall(base, curve, hold) === null);
      expect(baseFrom(base, curve), `curve ${index}`).toBe(first);
    }
  });

  it("is fifteen minutes on the default curve at its 10% base, earlier at a raised base, and zero with no curve", () => {
    expect([baseFrom(1_000, CURVE), baseFrom(1_500, CURVE), baseFrom(1_000, [])]).toEqual([900_000, 718_821, 0]);
    expect([feeAt(1_500, CURVE, 718_820), feeAt(1_500, CURVE, 718_821)]).toEqual([1_501, 1_500]);
  });
});

describe("openedAfter", () => {
  const units = fixedFromInt;
  const [now, opened, curveEnd] = [100_000, 40_000, 900_000];

  it("opens at now, averages an add towards now, keeps a reduction, restarts a flip and clears a close", () => {
    const cases: [number, number, number | null, number | null][] = [
      [0, 3, null, now], [1, 3, opened, 80_000], [-1, -4, opened, 85_000], [3, 1, opened, opened], [3, -1, opened, now], [3, 0, opened, null],
    ];
    for (const [held, after, open, expected] of cases) expect(openedAfter(units(held), open, units(after), now, curveEnd), `${held} -> ${after}`).toBe(expected);
  });

  it("rounds an add's share of the wait towards now, and lends an add at most the curve's length of age", () => {
    // A third of a millisecond is a whole one.
    expect(openedAfter(units(2), 0, units(3), 1, curveEnd)).toBe(1);
    // 60 s held under a 30 s curve lends the add 30 s, two thirds of which it averages away; an empty curve lends none.
    expect(openedAfter(units(1), opened, units(3), now, 30_000)).toBe(90_000);
    expect(openedAfter(units(3), opened, units(1), now, 30_000)).toBe(opened);
    expect(openedAfter(units(1), opened, units(3), now, 0)).toBe(now);
  });
});

describe("profitFee", () => {
  it("takes the rate of a gain rounded up to a raw unit, all of it at 100%, and nothing of a loss", () => {
    const gain = parseFixed("123.456789001");
    if (gain === null) throw new Error("bad fixture");
    expect(profitFee(gain, 1_000)).toBe(12_345_678_901n); // 12.3456789001, exact
    expect(profitFee(1n, 1_000)).toBe(1n);
    expect(profitFee(gain, 10_000)).toBe(gain);
    expect([profitFee(0n, 10_000), profitFee(-gain, 10_000)]).toEqual([0n, 0n]);
  });
});

describe("feeNow", () => {
  it("reads the hold, the rate, its next fall and when it reaches the base at a given time", () => {
    const opened = 1_000_000;
    expect(feeNow(opened, 1_000, CURVE, opened + 4_000)).toEqual({ holdMs: 4_000, feeBps: 10_000, fallsAt: opened + 10_007, baseAt: opened + 900_000 });
    expect(feeNow(opened, 1_000, CURVE, opened + 60_000)).toEqual({ holdMs: 60_000, feeBps: 6_421, fallsAt: opened + 60_005, baseAt: opened + 900_000 });
    expect(feeNow(opened, 1_000, CURVE, opened + 900_000)).toEqual({ holdMs: 900_000, feeBps: 1_000, fallsAt: null, baseAt: null });
    // A clock behind the open time, as a read can be, counts no hold.
    expect(feeNow(opened, 1_000, CURVE, opened - 5)).toEqual({ holdMs: 0, feeBps: 10_000, fallsAt: opened + 10_007, baseAt: opened + 900_000 });
  });
});
