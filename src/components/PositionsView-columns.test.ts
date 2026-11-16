/**
 * Tests for the Positions table's columns (monkey-trading/console#384, #386): the P&L at the close quote, not the mark, so a position whose
 * mark gain is smaller than its exit spread shows a loss; the profit fee on that close; and one row per position, with the figures
 * withheld in the same cells.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { MarketQuote } from "@/lib/engine/types";
import { fixedFromInt } from "@/lib/fixed";
import { LAUNCH_CURVE } from "@/lib/holding-fee";
import type { HouseParams } from "@/lib/house";
import type { AccountModel } from "@/lib/models";
import type { ConsoleState } from "@/lib/store/state";
import { btcAt } from "@/lib/ticket-fixtures";

import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { PositionsView } from "./PositionsView";

const PARAMS: HouseParams = { profitFeeBps: 1_000, closeoutLevelBps: 5_000, totalCapBps: 20_000, totalCapFloor: 0n, stressLevels: [], profitFeeCurve: [...LAUNCH_CURVE], seq: 1 };
/** A held position, opened long enough ago that the curve has run, so a close pays the base. */
const holding = (qty: number, entry: number): AccountModel => ({
  balance: fixedFromInt(10_000), unfinalised: 0n, equity: fixedFromInt(10_000), margin: 0n, orders: [],
  positions: [{ market: 1, qty: fixedFromInt(qty), entry: fixedFromInt(entry), closeout: null, closeFee: { openedAt: 0, feeBps: 1_000, fallsAt: null } }],
});
/** The node's quote for closing it: a long sells at the bid, a short buys at the offer. */
const closing = (side: "sell" | "buy", price: string): MarketQuote => ({
  type: "quote", account: "0xabc", market: 1, open: true, reduce_only: false, stress_level: 0, mark: "101000",
  ask: [{ qty: "5", price: "101020" }], bid: [{ qty: "5", price: "100980" }], close: { side, qty: "2", price },
});

const market = await btcAt(101_000);

function Seed({ patch }: { patch: Partial<ConsoleState> }) {
  const { store } = useSession();
  store.patch({ markets: [market], houseParams: PARAMS, pricingCurrent: true, now: 2_000_000, selected: 1, signatures: "checked", ...patch });
  return null;
}
const render = (patch: Partial<ConsoleState>) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed, { patch }), createElement(PositionsView)));
const cells = (html: string) => (html.split("<tbody>")[1] ?? "").split("</tr>").flatMap((row) => (row.includes("<td") ? [row.split("<td").length - 1] : []));

describe("a position whose mark gain is smaller than its exit spread", () => {
  it("shows a long's loss at the bid, with no profit fee, the gain at the mark in the explanation", () => {
    // 2 BTC from 100,990 at a mark of 101,000: +$20 at the mark, but the bid is 100,979.8.
    const html = render({ account: holding(2, 100_990), quotes: { 1: closing("sell", "100979.8") } });
    expect(html).toMatch(/<button[^>]*>-\$20\.40<\/button>/);
    expect(html).toContain("At the mark it is $20.00, before the exit spread.");
    expect(html).toContain('aria-hidden="false" class="block text-label text-fg-3">No profit fee on this close');
    expect(html).not.toMatch(/<button[^>]*>\$20\.00<\/button>/);
    // Its P&L in the card and in the table, and the table's close now, which pays no fee.
    expect(html.match(/<button[^>]*>-\$20\.40<\/button>/g)).toHaveLength(3);
  });

  it("shows a short's loss at the offer the same way", () => {
    // 2 BTC short from 101,010 at a mark of 101,000: +$20 at the mark, but the offer is 101,020.
    const html = render({ account: holding(-2, 101_010), quotes: { 1: closing("buy", "101020") } });
    expect(html).toMatch(/<button[^>]*>-\$20\.00<\/button>/);
    expect(html).toContain("At the mark it is $20.00, before the exit spread.");
    expect(html).toContain('aria-hidden="false" class="block text-label text-fg-3">No profit fee on this close');
  });
});

describe("a position at a gain after the exit spread", () => {
  it("shows the gain at the close quote, the fee in USD and what the close keeps", () => {
    // 2 x (100,979.8 - 100,000) = $1,959.60, a tenth of it the fee.
    const html = render({ account: holding(2, 100_000), quotes: { 1: closing("sell", "100979.8") } });
    expect(html).toMatch(/<button[^>]*>\$1,959\.60<\/button>/);
    expect(html).toMatch(/<button[^>]*>\$195\.96<\/button>/);
    expect(html).toMatch(/<button[^>]*>\$1,763\.64<\/button>/);
    // The card reserves the note's line, hidden from view and from a screen reader.
    expect(html).toContain('aria-hidden="true" class="block text-label invisible">No profit fee on this close');
  });
});

describe("the table's one row per position", () => {
  const quotes = { 1: closing("sell", "100979.8") };

  it("holds hold, fee rate, fee in USD and close now as columns, with no second line", () => {
    const html = render({ account: holding(2, 100_000), quotes });
    for (const head of ["Held", "Profit fee", "Fee \\(USD\\)", "Close now"]) expect(html).toMatch(new RegExp(`<th[^>]*><span[^>]*><button[^>]*>${head}<`));
    expect(cells(html)).toEqual([12]);
    expect(html).not.toContain('colspan="');
  });

  it("keeps the P&L at the close quote while the fee's terms are stale, and withholds the fee and what a close keeps, saying why", () => {
    const html = render({ account: holding(2, 100_000), quotes, pricingCurrent: false, houseStateStatus: "read" });
    expect(cells(html)).toEqual([12]);
    expect(html).toMatch(/<button[^>]*>\$1,959\.60<\/button>/);
    expect(html.split(">—</button>").length - 1).toBe(2);
    expect(html.split("Reading the node&#x27;s parameters again after a change.").length - 1).toBeGreaterThanOrEqual(3);
  });

  it("withholds every figure that needs a price while the node has quoted none", () => {
    const html = render({ account: holding(2, 100_000), quotes: {} });
    expect(cells(html)).toEqual([12]);
    // The card's P&L, and the table's three figures.
    expect(html.split(">—</button>").length - 1).toBe(4);
    expect(html).toContain("No closing price has reached the console yet. At the mark it is $2,000.00.");
  });

  it("gives the three figure columns the same width, shown or withheld, and keeps each a focusable explanation", () => {
    const widths = (html: string) => (html.split("<tbody>")[1] ?? "").match(/min-w-\[calc\(1[234]ch\+1rem\)\]/g);
    const shown = render({ account: holding(2, 100_000), quotes });
    const withheld = render({ account: holding(2, 100_000), quotes: {} });
    expect(widths(shown)).toEqual(["min-w-[calc(12ch+1rem)]", "min-w-[calc(13ch+1rem)]", "min-w-[calc(14ch+1rem)]"]);
    expect(widths(withheld)).toEqual(widths(shown));
    // The fee cell is the same element at a gain and at a loss, so a focused one survives a quote that crosses zero.
    const loss = render({ account: holding(2, 100_990), quotes });
    expect(shown).toMatch(/<button[^>]*>\$195\.96<\/button>/);
    expect(loss).toMatch(/<td[^>]*><span[^>]*><button[^>]*>\$0\.00<\/button>/);
  });

  it("wraps every explanation inside its box, whatever the cell's own white-space", () => {
    const tips = render({ account: holding(2, 100_000), quotes }).match(/<span id="[^"]*" role="tooltip"[^>]*>/g) ?? [];
    expect(tips.length).toBeGreaterThan(10);
    for (const tip of tips) expect(tip).toContain("whitespace-normal");
  });
});

describe("a fee that may still change", () => {
  it("is an upper bound rounded up to the cent, never below the fee", () => {
    // 60 s after the open the rate is 64.21% and about to fall: 2 x (100,979.8 - 100,000) = $1,959.60, and 64.21% of it is $1,258.25916.
    const account = holding(2, 100_000);
    const [position] = account.positions;
    if (position === undefined) throw new Error("no position");
    const html = render({ account: { ...account, positions: [{ ...position, closeFee: { openedAt: 1_940_000, feeBps: 6_421, fallsAt: 2_000_005 } }] }, quotes: { 1: closing("sell", "100979.8") } });
    expect(html).toMatch(/<button[^>]*>≤ \$1,258\.26<\/button>/);
  });
});
