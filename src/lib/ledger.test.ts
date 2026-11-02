import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import {
  addMessage, addPage, allocationsHeldFrom, allocationsShort, atBound, closedBefore, emptyLedger, MAX_ALLOCATIONS, MAX_ROWS, rowOf, rowsHeldFrom, rowsRemain,
} from "./ledger";
import { allocated, fill, lieu, message, ME, monkey, page, SCHEDULE } from "./ledger-kit";

const usd = fixedFromInt;

describe("rowOf", () => {
  it("makes a row of a fill that realised a loss, naming the side it closed and keeping its fee", () => {
    const row = rowOf(fill("7:0", 1_000, usd(-12), { side: "sell", qty: "2.5", price: "99.5", fee: usd(1), liquidation: true }));
    expect(row).toEqual({ cursor: "7:0", ts: 1_000, kind: "fill", market: 1, closed: "long", qty: usd(2) + 500_000_000n, price: usd(99) + 500_000_000n, realised: usd(-12), fee: usd(1), liquidation: true });
  });

  it("reads a buy that realised a profit as closing a short", () => {
    expect(rowOf(fill("7:0", 1_000, usd(5), { side: "buy" }))?.closed).toBe("short");
  });

  it("takes the side and size closed from the position held before the fill, so a reversal shows only what closed", () => {
    // Short 2, buys 5: the position after is long 3. The fill closed 2 of the short and opened 3 long.
    const reversal = rowOf(fill("7:0", 1_000, usd(-4), { side: "buy", qty: "5", position: "3" }));
    expect(reversal).toMatchObject({ closed: "short", qty: usd(2) });
    // Long 4, sells 1: the position after is long 3, and the fill closed 1 of the long.
    expect(rowOf(fill("7:1", 1_000, usd(2), { side: "sell", qty: "1", position: "3" }))).toMatchObject({ closed: "long", qty: usd(1) });
    // Long 2, sells 5: short 3 after; closed 2 of the long.
    expect(rowOf(fill("7:2", 1_000, usd(2), { side: "sell", qty: "5", position: "-3" }))).toMatchObject({ closed: "long", qty: usd(2) });
  });

  it("makes no row of a fill that realised nothing", () => {
    expect(rowOf(fill("7:0", 1_000, 0n))).toBeNull();
  });

  it("makes a row of a split's cash in lieu, with no side, size, price or fee", () => {
    expect(rowOf(lieu("9:2", 5, usd(-3)))).toEqual({ cursor: "9:2", ts: 5, kind: "corporate_cash_in_lieu", market: 1, closed: null, qty: null, price: null, realised: usd(-3), fee: 0n, liquidation: false });
    expect(rowOf(lieu("9:2", 5, 0n))).toBeNull();
  });

  it("makes no row of an allocation", () => {
    expect(rowOf(allocated("9:2", 5, 0, 1n))).toBeNull();
  });
});

describe("addPage", () => {
  it("keeps rows of every kind newest first by cursor, whatever order the pages arrive in", () => {
    let data = addPage(emptyLedger(), "fill", page([fill("10:0", 100, usd(-1)), fill("4:3", 40, usd(2))], "4:3"));
    data = addPage(data, "corporate_cash_in_lieu", page([lieu("10:1", 100, usd(-2)), lieu("6:0", 60, usd(1))]));
    expect(data.rows.map((r) => r.cursor)).toEqual(["10:1", "10:0", "6:0", "4:3"]);
  });

  it("orders cursors numerically, not as text", () => {
    const data = addPage(emptyLedger(), "fill", page([fill("100:0", 2, usd(1)), fill("9:0", 1, usd(1))]));
    expect(data.rows.map((r) => r.cursor)).toEqual(["100:0", "9:0"]);
  });

  it("holds a row once when a page is read again", () => {
    const first = addPage(emptyLedger(), "fill", page([fill("10:0", 100, usd(-1))]));
    expect(addPage(first, "fill", page([fill("10:0", 100, usd(-1))])).rows).toHaveLength(1);
  });

  it("records how far each stream was read: its oldest stamp, where to read on, and whether it ended", () => {
    const data = addPage(emptyLedger(), "fill", page([fill("10:0", 100, usd(-1)), fill("8:0", 80, 0n)], "8:0"));
    expect(data.cover.fill).toEqual({ oldest: 80, next: "8:0", done: false });
    const ended = addPage(data, "fill", page([fill("3:0", 30, usd(1))], null));
    expect(ended.cover.fill).toEqual({ oldest: 30, next: null, done: true });
  });

  it("counts a fill that realised nothing toward how far the stream was read, though it makes no row", () => {
    const data = addPage(emptyLedger(), "fill", page([fill("10:0", 100, 0n)], "10:0"));
    expect(data.rows).toHaveLength(0);
    expect(data.cover.fill.oldest).toBe(100);
  });

  it("marks an empty last page as the end of the stream", () => {
    expect(addPage(emptyLedger(), "fill", page([])).cover.fill.done).toBe(true);
  });

  it("holds an allocation by period, and knows every period up to it has closed", () => {
    const data = addPage(emptyLedger(), "emission_allocated", page([allocated("12:0", 7 * 600_000 + 1, 6, monkey(3n))], "12:0"));
    expect(data.allocations).toEqual([{ cursor: "12:0", ts: 7 * 600_000 + 1, period: 6, amount: monkey(3n) }]);
    expect(data.closedThrough).toBe(6);
  });
});

describe("how far the streams are read", () => {
  const read = (fills: ReturnType<typeof page>, lieus: ReturnType<typeof page>) => addPage(addPage(emptyLedger(), "fill", fills), "corporate_cash_in_lieu", lieus);

  it("holds rows only from the newer of the two row streams' oldest stamps", () => {
    const data = read(page([fill("9:0", 900, usd(1))], "9:0"), page([lieu("5:0", 500, usd(1))], "5:0"));
    expect(rowsHeldFrom(data)).toBe(900);
    expect(rowsRemain(data)).toBe(true);
  });

  it("holds every row once both row streams end", () => {
    const data = read(page([fill("9:0", 900, usd(1))]), page([]));
    expect(rowsHeldFrom(data)).toBe(Number.NEGATIVE_INFINITY);
    expect(rowsRemain(data)).toBe(false);
  });

  it("holds no row before a row stream is read at all", () => {
    expect(rowsHeldFrom(addPage(emptyLedger(), "fill", page([], null)))).toBe(Number.POSITIVE_INFINITY);
  });

  it("says allocations are short when the oldest row's period ends at or before the oldest allocation read", () => {
    const rows = addPage(addPage(emptyLedger(), "fill", page([fill("9:0", 3 * 600_000 + 5, usd(-1))])), "corporate_cash_in_lieu", page([]));
    const cut = addPage(rows, "emission_allocated", page([allocated("20:0", 5 * 600_000, 4, 1n)], "20:0"));
    expect(allocationsHeldFrom(cut)).toBe(5 * 600_000);
    expect(allocationsShort(cut, SCHEDULE)).toBe(true);
    const reached = addPage(cut, "emission_allocated", page([allocated("12:0", 4 * 600_000 - 1, 2, 1n)], "12:0"));
    expect(allocationsShort(reached, SCHEDULE)).toBe(false);
    expect(allocationsShort(addPage(rows, "emission_allocated", page([])), SCHEDULE)).toBe(false);
  });

  it("is not short once the allocation of the oldest row's own period is held, whatever the cover", () => {
    const rows = addPage(emptyLedger(), "fill", page([fill("9:0", 3 * 600_000 + 5, usd(-1))]));
    const held = addPage(rows, "emission_allocated", page([allocated("20:0", 4 * 600_000 + 1, 3, 1n)], "20:0"));
    expect(allocationsShort(held, SCHEDULE)).toBe(false);
  });

  it("chases allocations only for rows the row streams hold whole, not for an old cash in lieu row the fills have not reached", () => {
    let data = addPage(emptyLedger(), "fill", page([fill("40:0", 5 * 600_000 + 5, usd(-1)), fill("39:0", 3 * 600_000 + 5, usd(-1))], "39:0"));
    data = addPage(data, "corporate_cash_in_lieu", page([lieu("3:0", 600_000 + 5, usd(-1))]));
    data = addPage(data, "emission_allocated", page([allocated("50:0", 7 * 600_000, 6, 1n)], "50:0"));
    // Period 1's lieu row and period 3's fill are older than where the fills were read: neither allocation is the one to chase, period 5's is.
    expect(allocationsShort(data, SCHEDULE)).toBe(true);
    const reached = addPage(data, "emission_allocated", page([allocated("45:0", 6 * 600_000 + 1, 5, 1n)], "45:0"));
    expect(allocationsShort(reached, SCHEDULE)).toBe(false);
  });

  it("is never short without a schedule or without rows", () => {
    expect(allocationsShort(emptyLedger(), SCHEDULE)).toBe(false);
    const rows = addPage(emptyLedger(), "fill", page([fill("9:0", 5, usd(-1))]));
    expect(allocationsShort(addPage(rows, "emission_allocated", page([], "1:0")), null)).toBe(false);
  });
});

describe("addMessage", () => {
  const base = addPage(emptyLedger(), "fill", page([], null));

  it("adds this account's fill with a cursor of its seq and place in the command", () => {
    const data = addMessage(base, message(30, 5_000, [{ type: "market_opened", market: 1 }, fill("x", 0, usd(-4))]), ME);
    expect(data.rows.map((r) => [r.cursor, r.ts, r.realised])).toEqual([["30:1", 5_000, usd(-4)]]);
  });

  it("matches the account without regard to case", () => {
    expect(addMessage(base, message(30, 5_000, [fill("x", 0, usd(-4))]), ME.toUpperCase().replace("0X", "0x")).rows).toHaveLength(1);
  });

  it("leaves another account's events out", () => {
    const other = { ...fill("x", 0, usd(-4)), account: "0xdef0000000000000000000000000000000000002" };
    expect(addMessage(base, message(30, 5_000, [other]), ME)).toBe(base);
  });

  it("returns the very same object for a message that concerns the ledger not at all, so a price patch redraws nothing", () => {
    expect(addMessage(base, message(31, 6_000, [{ type: "market_opened", market: 1 }]), ME)).toBe(base);
    expect(addMessage(base, message(31, 6_000, [fill("x", 0, 0n)]), ME)).toBe(base);
  });

  it("holds a row once when a page already read it", () => {
    const paged = addPage(emptyLedger(), "fill", page([fill("30:0", 5_000, usd(-4))]));
    const data = addMessage(paged, message(30, 5_000, [fill("x", 0, usd(-4))]), ME);
    expect(data.rows).toHaveLength(1);
    expect(data).toBe(paged);
  });

  it("takes a period close as proof that period and every one before it closed, and its allocation with it", () => {
    const data = addMessage(base, message(40, 4 * 600_000 + 3, [allocated("x", 0, 3, monkey(2n)), { type: "emission_period_closed", period: 3, budget: "1", allocated: "1", cancelled: "0" }]), ME);
    expect(data.closedThrough).toBe(3);
    expect(data.allocations.map((a) => [a.period, a.amount])).toEqual([[3, monkey(2n)]]);
  });

  it("raises the closed period when a close arrives for a period with no allocation to the account", () => {
    const data = addMessage(base, message(40, 4 * 600_000 + 3, [{ type: "emission_period_closed", period: 3, budget: "1", allocated: "0", cancelled: "1" }]), ME);
    expect(data.closedThrough).toBe(3);
  });

  it("never lowers the closed period", () => {
    const high = { ...base, closedThrough: 9 };
    expect(addMessage(high, message(40, 1, [{ type: "emission_period_closed", period: 3, budget: "1", allocated: "0", cancelled: "1" }]), ME)).toBe(high);
  });
});

describe("closedBefore", () => {
  it("takes the periods before the node's open one as closed", () => {
    expect(closedBefore(emptyLedger(), SCHEDULE).closedThrough).toBe(4);
  });

  it("changes nothing before the schedule starts, or when more is already known", () => {
    const data = emptyLedger();
    expect(closedBefore(data, { ...SCHEDULE, period: null })).toBe(data);
    const high = { ...data, closedThrough: 8 };
    expect(closedBefore(high, SCHEDULE)).toBe(high);
  });
});

describe("what is held stays bounded", () => {
  it("drops the oldest rows past the bound and resumes reading below the oldest one kept", () => {
    let data = emptyLedger();
    for (let i = 1; i <= MAX_ROWS + 1; i += 1) data = addMessage(data, message(i, i * 1_000, [fill("x", 0, usd(-1))]), ME);
    expect(data.rows).toHaveLength(MAX_ROWS);
    expect(data.rows[data.rows.length - 1]?.cursor).toBe("2:0");
    expect(data.cover.fill).toEqual({ oldest: 2_000, next: "2:0", done: false });
    expect(atBound(data)).toBe(true);
  });

  it("leaves a stream that lost no row read to where it was, even when the other stream's rows are dropped", () => {
    let data = addPage(emptyLedger(), "corporate_cash_in_lieu", page([lieu("1500:5", 1_500_000, usd(-1))]));
    for (let i = 1; i <= MAX_ROWS + 1; i += 1) data = addMessage(data, message(i, i * 1_000, [fill("x", 0, usd(-1))]), ME);
    expect(data.rows).toHaveLength(MAX_ROWS);
    expect(data.cover.corporate_cash_in_lieu).toEqual({ oldest: 1_500_000, next: null, done: true });
    expect(data.cover.fill.done).toBe(false);
  });

  it("is at its bound by rows alone: many allocations never stop the row reads", () => {
    let data = emptyLedger();
    for (let i = 1; i <= MAX_ALLOCATIONS - 1; i += 1) data = addMessage(data, message(i, i * 600_000, [allocated("x", 0, i, 1n)]), ME);
    expect(atBound(data)).toBe(false);
  });

  it("drops the oldest allocations past the bound the same way", () => {
    let data = emptyLedger();
    for (let i = 1; i <= MAX_ALLOCATIONS + 1; i += 1) data = addMessage(data, message(i, i * 600_000, [allocated("x", 0, i, 1n)]), ME);
    expect(data.allocations).toHaveLength(MAX_ALLOCATIONS);
    expect(data.cover.emission_allocated).toEqual({ oldest: 2 * 600_000, next: "2:0", done: false });
  });
});
