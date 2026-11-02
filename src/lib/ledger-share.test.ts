import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { addMessage, addPage, closedBefore, emptyLedger, type LedgerData } from "./ledger";
import { allocated, fill, lieu, message, ME, monkey, page, SCHEDULE } from "./ledger-kit";
import { sharesOf, splitExactly, totalsOf, viewOf } from "./ledger-share";

const usd = fixedFromInt;
const PERIOD = SCHEDULE.periodMs;
/** A stamp inside emission period `n`, `offset` ms from its start. */
const inPeriod = (n: number, offset = 1_000) => n * PERIOD + offset;

/** All three streams read to their start, with periods before the schedule's open one (5) closed. */
function held(fills: ReturnType<typeof fill>[], allocations: ReturnType<typeof allocated>[] = [], lieus: ReturnType<typeof lieu>[] = []): LedgerData {
  let data = addPage(emptyLedger(), "fill", page(fills));
  data = addPage(data, "corporate_cash_in_lieu", page(lieus));
  data = addPage(data, "emission_allocated", page(allocations));
  return closedBefore(data, SCHEDULE);
}

describe("splitExactly", () => {
  it("gives one loss the whole amount", () => {
    expect(splitExactly(monkey(7n) + 3n, [usd(5)])).toEqual([monkey(7n) + 3n]);
  });

  it("splits in proportion to the losses when the division is exact", () => {
    expect(splitExactly(1_000n, [usd(1), usd(3)])).toEqual([250n, 750n]);
  });

  it("sums to the amount exactly, handing the units truncation drops to the largest remainders", () => {
    // 10 over thirds: floors 3, 3, 3 leave one unit, for the first of the equal remainders (the oldest row).
    expect(splitExactly(10n, [usd(1), usd(1), usd(1)])).toEqual([4n, 3n, 3n]);
    // 100 over 1:2:4: exact shares 14.28, 28.57, 57.14; floors 14, 28, 57 leave 1, for the largest remainder (the middle row).
    expect(splitExactly(100n, [usd(1), usd(2), usd(4)])).toEqual([14n, 29n, 57n]);
  });

  it("sums to the amount for many awkward splits", () => {
    for (let n = 1; n <= 40; n += 1) {
      const losses = Array.from({ length: n }, (_, i) => BigInt((i * 7919 + 13) % 997 + 1) * 1_000_003n);
      for (const amount of [0n, 1n, 17n, monkey(1_000n), monkey(1_000n) - 1n, 123_456_789_012_345_678_901n]) {
        const parts = splitExactly(amount, losses);
        expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(amount);
        expect(parts.every((part) => part >= 0n)).toBe(true);
      }
    }
  });

  it("never gives a larger loss less than a smaller one", () => {
    const parts = splitExactly(monkey(1n) + 1n, [usd(1), usd(2), usd(3), usd(4), usd(5), usd(6), usd(7)]);
    expect(parts.slice(1).every((part, i) => part >= (parts[i] ?? 0n))).toBe(true);
  });

  it("refuses losses that do not add to something to divide by", () => {
    expect(() => splitExactly(10n, [])).toThrow("positive");
  });
});

describe("sharesOf", () => {
  it("gives the only losing row of a closed period the whole allocation", () => {
    const data = held([fill("9:0", inPeriod(2), usd(-5))], [allocated("20:0", inPeriod(3), 2, monkey(40n))]);
    expect(sharesOf(data, SCHEDULE).get("9:0")).toEqual({ kind: "share", units: monkey(40n) });
  });

  it("splits a period's allocation over its losing rows in proportion, summing to it exactly", () => {
    const amount = monkey(100n) + 7n;
    const data = held(
      [fill("9:0", inPeriod(2, 1), usd(-1)), fill("9:1", inPeriod(2, 2), usd(-2)), fill("9:2", inPeriod(2, 3), usd(-4))],
      [allocated("20:0", inPeriod(3), 2, amount)],
    );
    const shares = sharesOf(data, SCHEDULE);
    const units = ["9:0", "9:1", "9:2"].map((cursor) => {
      const share = shares.get(cursor);
      if (share?.kind !== "share") throw new Error(`expected a share for ${cursor}`);
      return share.units;
    });
    expect(units.reduce((sum, u) => sum + u, 0n)).toBe(amount);
    expect(units[0]).toBeLessThan(units[1] ?? 0n);
    expect(units[1]).toBeLessThan(units[2] ?? 0n);
    expect(units).toEqual(splitExactly(amount, [usd(1), usd(2), usd(4)]));
  });

  it("shares each period's allocation over that period's rows alone", () => {
    const data = held(
      [fill("9:0", inPeriod(2), usd(-1)), fill("12:0", inPeriod(3), usd(-1)), fill("12:1", inPeriod(3, 2_000), usd(-1))],
      [allocated("21:0", inPeriod(4), 3, monkey(10n)), allocated("20:0", inPeriod(3), 2, monkey(30n))],
    );
    const shares = sharesOf(data, SCHEDULE);
    expect(shares.get("9:0")).toEqual({ kind: "share", units: monkey(30n) });
    expect(shares.get("12:0")).toEqual({ kind: "share", units: monkey(5n) });
    expect(shares.get("12:1")).toEqual({ kind: "share", units: monkey(5n) });
  });

  it("shows a loss in a period that closed with no allocation as zero", () => {
    const data = held([fill("9:0", inPeriod(2), usd(-5))], [allocated("20:0", inPeriod(1), 0, monkey(1n))]);
    expect(sharesOf(data, SCHEDULE).get("9:0")).toEqual({ kind: "zero" });
  });

  it("shows a loss in the open period as pending, even when its allocation is somehow held", () => {
    const data = held([fill("9:0", inPeriod(5), usd(-5)), fill("9:1", inPeriod(4), usd(-5))], [allocated("20:0", inPeriod(5), 5, monkey(1n))]);
    const shares = sharesOf({ ...data, closedThrough: 4 }, SCHEDULE);
    expect(shares.get("9:0")).toEqual({ kind: "pending" });
    expect(shares.get("9:1")).toEqual({ kind: "zero" });
  });

  it("turns a pending loss into a share when the stream closes its period", () => {
    const data = held([fill("9:0", inPeriod(5), usd(-5))]);
    expect(sharesOf(data, SCHEDULE).get("9:0")).toEqual({ kind: "pending" });
    const closed = addMessage(data, message(30, inPeriod(6), [allocated("x", 0, 5, monkey(9n)), { type: "emission_period_closed", period: 5, budget: "1", allocated: "1", cancelled: "0" }]), ME);
    expect(sharesOf(closed, SCHEDULE).get("9:0")).toEqual({ kind: "share", units: monkey(9n) });
  });

  it("gives a win no share and leaves a loss's share as if the win were not there (the gross rule)", () => {
    const allocations = [allocated("20:0", inPeriod(3), 2, monkey(40n))];
    const alone = sharesOf(held([fill("9:0", inPeriod(2, 1), usd(-5))], allocations), SCHEDULE);
    const withWin = sharesOf(held([fill("9:1", inPeriod(2, 2), usd(50)), fill("9:0", inPeriod(2, 1), usd(-5))], allocations), SCHEDULE);
    expect(withWin.get("9:1")).toBeUndefined();
    expect(withWin.get("9:0")).toEqual(alone.get("9:0"));
    expect(withWin.get("9:0")).toEqual({ kind: "share", units: monkey(40n) });
  });

  it("counts a split's cash in lieu loss with the period's fills, and gives a gain none", () => {
    const data = held(
      [fill("9:0", inPeriod(2, 1), usd(-3))], [allocated("20:0", inPeriod(3), 2, monkey(40n))],
      [lieu("9:1", inPeriod(2, 2), usd(-1)), lieu("9:2", inPeriod(2, 3), usd(8))],
    );
    const shares = sharesOf(data, SCHEDULE);
    expect(shares.get("9:0")).toEqual({ kind: "share", units: monkey(30n) });
    expect(shares.get("9:1")).toEqual({ kind: "share", units: monkey(10n) });
    expect(shares.has("9:2")).toBe(false);
  });

  it("knows no share without a schedule", () => {
    const data = held([fill("9:0", inPeriod(2), usd(-5)), fill("9:1", inPeriod(2), usd(5))]);
    const shares = sharesOf(data, null);
    expect(shares.get("9:0")).toEqual({ kind: "unknown" });
    expect(shares.has("9:1")).toBe(false);
  });

  describe("when paging cut a period", () => {
    // Fills read down to a stamp inside period 2; allocations read from period 3 on.
    const allocations = [allocated("20:0", inPeriod(3), 2, monkey(40n))];
    const cutAt = (oldest: number) => {
      let data = addPage(emptyLedger(), "fill", page([fill("9:0", inPeriod(3), usd(-1)), fill("8:5", inPeriod(2, 100), usd(-1)), fill("8:0", oldest, usd(-1))], "8:0"));
      data = addPage(data, "corporate_cash_in_lieu", page([]));
      data = addPage(data, "emission_allocated", page(allocations));
      return closedBefore(data, SCHEDULE);
    };

    it("shows the rows of a period the fill stream may not have finished as loading, not as a wrong share", () => {
      const shares = sharesOf(cutAt(inPeriod(2, 50)), SCHEDULE);
      expect(shares.get("8:0")).toEqual({ kind: "loading" });
      expect(shares.get("8:5")).toEqual({ kind: "loading" });
    });

    it("still tells a newer period whole", () => {
      const shares = sharesOf(cutAt(inPeriod(2, 50)), SCHEDULE);
      expect(shares.get("9:0")).toEqual({ kind: "zero" });
    });

    it("holds a period whole once the stream has read strictly past its start, and not before", () => {
      // The oldest stamp read is the period's very first millisecond: a sibling stamped alike may be unread.
      expect(sharesOf(cutAt(inPeriod(2, 0)), SCHEDULE).get("8:5")).toEqual({ kind: "loading" });
      // Read to the last millisecond before it, the whole period is held; only the row at the cut stays loading.
      const past = sharesOf(cutAt(inPeriod(2, 0) - 1), SCHEDULE);
      expect(past.get("8:5")).toEqual({ kind: "share", units: monkey(40n) });
      expect(past.get("8:0")).toEqual({ kind: "loading" });
    });

    it("waits on the cash in lieu stream too, though the fills reach back", () => {
      let data = addPage(emptyLedger(), "fill", page([fill("8:0", inPeriod(2), usd(-1))]));
      data = addPage(data, "corporate_cash_in_lieu", page([lieu("7:0", inPeriod(3), usd(1))], "7:0"));
      data = addPage(data, "emission_allocated", page(allocations));
      expect(sharesOf(closedBefore(data, SCHEDULE), SCHEDULE).get("8:0")).toEqual({ kind: "loading" });
    });

    it("waits on the allocations when they have not reached back to the period's close", () => {
      let data = addPage(emptyLedger(), "fill", page([fill("8:0", inPeriod(2), usd(-1))]));
      data = addPage(data, "corporate_cash_in_lieu", page([]));
      data = addPage(data, "emission_allocated", page([allocated("30:0", inPeriod(4), 3, monkey(1n))], "30:0"));
      const closed = closedBefore(data, SCHEDULE);
      expect(sharesOf(closed, SCHEDULE).get("8:0")).toEqual({ kind: "loading" });
      // Read on to an allocation stamped before the period closed: the period has no allocation, which is now known.
      const reached = addPage(closed, "emission_allocated", page([allocated("5:0", inPeriod(2, 100), 1, monkey(1n))]));
      expect(sharesOf(reached, SCHEDULE).get("8:0")).toEqual({ kind: "zero" });
    });
  });
});

describe("totalsOf and viewOf", () => {
  const data = held(
    [fill("9:0", inPeriod(2, 1), usd(-3), { fee: 0n }), fill("9:1", inPeriod(2, 2), usd(10), { fee: usd(1) }), fill("12:0", inPeriod(5), usd(-2))],
    [allocated("20:0", inPeriod(3), 2, monkey(40n))],
  );

  it("sums realised results and fees over the held rows, and the MONKEY whose share is known", () => {
    const { totals } = viewOf(data, SCHEDULE);
    expect(totals.realised).toBe(usd(5));
    expect(totals.fees).toBe(usd(1));
    expect(totals.monkey).toBe(monkey(40n));
  });

  it("says the MONKEY total is short while a loss's share is pending, loading or unknown", () => {
    expect(viewOf(data, SCHEDULE).totals.monkeyShort).toBe(true);
    expect(viewOf(held([fill("9:0", inPeriod(2), usd(-3))], [allocated("20:0", inPeriod(3), 2, monkey(1n))]), SCHEDULE).totals.monkeyShort).toBe(false);
    expect(totalsOf(data.rows, sharesOf(data, null)).monkeyShort).toBe(true);
  });

  it("pairs each row with its share, newest first", () => {
    const { items } = viewOf(data, SCHEDULE);
    expect(items.map((item) => [item.row.cursor, item.share.kind])).toEqual([["12:0", "pending"], ["9:1", "none"], ["9:0", "share"]]);
  });

  it("totals nothing for no rows", () => {
    expect(viewOf(emptyLedger(), SCHEDULE).totals).toEqual({ realised: 0n, fees: 0n, monkey: 0n, monkeyShort: false });
  });
});
