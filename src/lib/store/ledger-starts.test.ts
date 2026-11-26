/** The start the P&L tab keeps (monkey-trading/console#526, #529): the earliest any page stated, and what the totals claim from the pages that reached each list's end. */

import { describe, expect, it } from "vitest";

import { settle } from "../engine/test-kit";
import type { HistoryPage } from "../engine/types";
import { fixedFromInt } from "../fixed";
import { completeFrom } from "../ledger";
import { coverageNote, ledgerHeader } from "../ledger-cell";
import { allocated, fill, lieu, MIN, monkey, page, SCHEDULE } from "../ledger-kit";
import { ACCOUNT } from "./live-fake";
import { opened } from "./ledger-store-kit";

const usd = fixedFromInt;
const PERIOD = SCHEDULE.periodMs;
const S = Date.UTC(2026, 9, 26, 13, 52);
const from = (ms: number | null, events: Parameters<typeof page>[0], next: string | null = null): HistoryPage => ({ ...page(events, next), retained_from_ms: ms });

describe("the start Load more keeps", () => {
  it("keeps the earliest start stated, and claims the totals only from the start the last page of each list stated", async () => {
    const { store, ledger } = await opened({
      fill: { "": from(S, [fill("20:0", 100, usd(-1))], "20:0"), "20:0": from(S + 5 * MIN, [fill("10:0", 50, usd(-1))]) },
      corporate_cash_in_lieu: { "": from(S, [lieu("15:0", 80, usd(1))]) },
    });
    store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().begins).toBe(S);
    expect(completeFrom(ledger().data)).toBeNull();
    await store.ledger.loadMore();
    expect(ledger().begins).toBe(S);
    expect(completeFrom(ledger().data)).toBe(S + 5 * MIN);
    const { status } = ledgerHeader(ledger(), 3, { realised: 0n, fees: 0n, monkey: 0n, monkeyShort: false }, false, false, completeFrom(ledger().data));
    expect(status).toBe(coverageNote(3, { realised: 0n, fees: 0n, monkey: 0n, monkeyShort: false }, false, false, S + 5 * MIN));
    expect(status).toContain("since 2026-10-26 13:57 UTC");
    expect(status).not.toContain("13:52");
  });

  it("keeps the held start when a later page states none", async () => {
    const { store, ledger } = await opened({
      fill: { "": from(S, [fill("20:0", 100, usd(-1))], "20:0"), "20:0": from(null, [fill("10:0", 50, usd(-1))]) },
    });
    store.ledger.open(ACCOUNT);
    await settle();
    await store.ledger.loadMore();
    expect(ledger().begins).toBe(S);
    expect(completeFrom(ledger().data)).toBe(S);
  });

  it("claims from the later of the two row lists' starts", async () => {
    const { store, ledger } = await opened({
      fill: { "": from(S, [fill("20:0", 100, usd(-1))]) },
      corporate_cash_in_lieu: { "": from(S + 9 * MIN, [lieu("15:0", 80, usd(1))]) },
    });
    store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().begins).toBe(S);
    expect(completeFrom(ledger().data)).toBe(S + 9 * MIN);
  });
});

describe("the start the allocation reach keeps", () => {
  it("keeps the earliest start across the older allocation pages, and leaves the claim to the row lists", async () => {
    const { store, ledger } = await opened({
      fill: { "": from(S + MIN, [fill("20:0", 2 * PERIOD + 5, usd(-1))]) },
      emission_allocated: {
        "": from(S + MIN, [allocated("40:0", 6 * PERIOD, 5, 1n)], "40:0"),
        "40:0": from(S, [allocated("30:0", 4 * PERIOD, 3, 1n)], "30:0"),
        "30:0": from(S + 9 * MIN, [allocated("21:0", 3 * PERIOD + 1, 2, monkey(8n))], "21:0"),
      },
    });
    store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().begins).toBe(S);
    expect(completeFrom(ledger().data)).toBe(S + MIN);
  });
});

describe("the claim when held rows are trimmed", () => {
  it("makes none while a list has more below it", async () => {
    const { store, ledger } = await opened({ fill: { "": from(S, [fill("20:0", 100, usd(-1))], "20:0") } });
    store.ledger.open(ACCOUNT);
    await settle();
    expect(completeFrom(ledger().data)).toBeNull();
  });
});
