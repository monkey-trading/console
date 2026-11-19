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
/** The text of each cell of the table's rows, without the explanation a cell's `Term` holds. */
const rows = (html: string) => (html.split("<tbody>")[1] ?? "").split("</tr>").filter((row) => row.includes("<td")).map((row) => row.split("<td").slice(1).map((cell) => cell.replace(/<span id="[^"]*" role="tooltip"[\s\S]*$/, "").replace(/<[^>]*>/g, "").replace(/^[^>]*>/, "")));
const cells = (html: string) => rows(html).map((row) => row.length);
/** The explanation of a row's details, in the table. */
const details = (html: string) => (html.split("<tbody>")[1] ?? "").match(/role="tooltip"[^>]*><span[^>]*><span[^>]*>([^<]*)</)?.[1]?.replaceAll("&#x27;", "'") ?? "";

const GAIN = { account: holding(2, 100_000), quotes: { 1: closing("sell", "100979.8") } };
// The cells by column: market and side, size and held, entry and mark, take profit and stop loss, P&L and its details, fee rate and when it falls,
// fee in USD and the close-out, close now and its button.
const PNL = 4;
const FEE_RATE = 5;
const FEE_USD = 6;
const CLOSE_NOW = 7;

describe("a position whose mark gain is smaller than its exit spread", () => {
  it("shows a long's loss at the bid, with no profit fee, the gain at the mark in the explanation", () => {
    // 2 BTC from 100,990 at a mark of 101,000: +$20 at the mark, but the bid is 100,979.8.
    const html = render({ account: holding(2, 100_990), quotes: { 1: closing("sell", "100979.8") } });
    const [row] = rows(html);
    expect([row?.[PNL], row?.[FEE_USD], row?.[CLOSE_NOW]]).toEqual(["-$20.40Details", "$0.00Close-out —", "-$20.40Close"]);
    expect(details(html)).toBe("This figure is calculated at the price at which the entire position would close. At the mark price, before the spread, the unrealised profit or loss is $20.00. No profit fee applies, because closing the position now would not realise a profit.");
    expect(html).toContain('aria-hidden="false" class="block text-label text-fg-3">No fee without a profit');
  });

  it("shows a short's loss at the offer the same way", () => {
    // 2 BTC short from 101,010 at a mark of 101,000: +$20 at the mark, but the offer is 101,020.
    const html = render({ account: holding(-2, 101_010), quotes: { 1: closing("buy", "101020") } });
    const [row] = rows(html);
    expect([row?.[PNL], row?.[FEE_USD], row?.[CLOSE_NOW]]).toEqual(["-$20.00Details", "$0.00Close-out —", "-$20.00Close"]);
    expect(details(html)).toContain("At the mark price, before the spread, the unrealised profit or loss is $20.00. No profit fee applies, because closing the position now would not realise a profit.");
  });
});

describe("a position at a gain after the exit spread", () => {
  it("shows the gain at the close quote, the fee in USD and what the close keeps", () => {
    // 2 x (100,979.8 - 100,000) = $1,959.60, a tenth of it the fee.
    const html = render(GAIN);
    const [row] = rows(html);
    expect([row?.[PNL], row?.[FEE_USD], row?.[CLOSE_NOW]]).toEqual(["$1,959.60Details", "$195.96Close-out —", "$1,763.64Close"]);
    expect(details(html)).toBe("This figure is calculated at the price at which the entire position would close. At the mark price, before the spread, the unrealised profit or loss is $2,000.00.");
    // The card reserves the note's line, hidden from view and from a screen reader.
    expect(html).toContain('aria-hidden="true" class="block text-label invisible">No fee without a profit');
  });
});

describe("the table's one row per position", () => {
  it("holds the hold, levels, fee rate, fee in USD, close-out and close now in columns of two lines at most, so the table fits a 740 px pane", () => {
    const html = render(GAIN);
    for (const head of ["Profit fee", "Close now"]) expect(html).toMatch(new RegExp(`<th[^>]*><span[^>]*><button[^>]*>${head}<`));
    expect(html).toMatch(/<th[^>]*><span[^>]*>Size<\/span><span[^>]*><span[^>]*><button[^>]*>Held</);
    expect(html).toMatch(/<th[^>]*><span class="block"><span[^>]*><button[^>]*>Take profit<\/button>.*?<\/span><\/span><span class="block">Stop loss<\/span><\/th>/);
    expect(html).toMatch(/<th[^>]*><span class="block"><span[^>]*><button[^>]*>Fee \(USD\)<\/button>.*?<\/span><\/span><span class="block"><span[^>]*><button[^>]*>Close-out</);
    expect(rows(html)[0]?.[3]).toBe("Add");
    expect(rows(html)[0]?.[1]).toBe("2.000000Held 33m 20s");
    expect(cells(html)).toEqual([8]);
    expect(html).not.toContain('colspan="');
  });

  it("keeps the P&L at the close quote while the fee's terms are stale, and withholds the fee and what a close keeps, saying why", () => {
    const html = render({ ...GAIN, pricingCurrent: false, houseStateStatus: "read" });
    const [row] = rows(html);
    expect([row?.[PNL], row?.[FEE_USD], row?.[CLOSE_NOW]]).toEqual(["$1,959.60Details", "—Close-out —", "—Close"]);
    expect(details(html)).toContain("The profit fee and closing figures are not yet available. The trading terms have changed. The new terms are loading.");
  });

  it("withholds every figure that needs a price while the node has quoted none, naming the market to select", () => {
    const html = render({ account: holding(2, 100_000), quotes: {} });
    const [row] = rows(html);
    expect([row?.[PNL], row?.[FEE_USD], row?.[CLOSE_NOW]]).toEqual(["—Details", "—Close-out —", "—Close"]);
    expect(details(html)).toContain("Select BTC-USD in the watchlist to load its closing price. At the mark price, the unrealised profit or loss is $2,000.00.");
  });

  it("says a closed market is closed, not that its rate is unread, though the mock still prices it", () => {
    const html = render({ ...GAIN, markets: [{ ...market, open: false }] });
    expect(details(html)).toContain("The market is closed, so no closing price is available.");
    expect(details(html)).not.toContain("rate has not loaded");
  });

  it("gives the figure columns the same width, shown or withheld, and the hold room for its longest value", () => {
    const widths = (html: string) => (html.split("<tbody>")[1] ?? "").match(/min-w-\[[^\]]*\]/g);
    const withheld = render({ account: holding(2, 100_000), quotes: {} });
    expect(widths(render(GAIN))).toEqual(["min-w-[12ch]", "min-w-[8ch]", "min-w-[16ch]", "min-w-[calc(13ch+0.75rem)]", "min-w-[calc(14ch+0.75rem)]"]);
    expect(widths(withheld)).toEqual(widths(render(GAIN)));
  });

  it("holds no live figure as the name of a button", () => {
    const html = render(GAIN);
    const names = [...(html.split("<tbody>")[1] ?? "").matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    expect(names).toEqual(["Add", "Details", "Close"]);
  });

  it("wraps every explanation inside its box, whatever the cell's own white-space", () => {
    const tips = render(GAIN).match(/<span id="[^"]*" role="tooltip"[^>]*>/g) ?? [];
    expect(tips.length).toBeGreaterThan(10);
    for (const tip of tips) expect(tip).toContain("whitespace-normal");
  });
});

describe("the profit fee rate's cell", () => {
  it("says when the rate next falls under the rate in 16 characters, the whole sentence kept for a screen reader", () => {
    expect(rows(render(GAIN))[0]?.[FEE_RATE]).toBe("10.00%Base rateBase rate");
    const account = holding(2, 100_000);
    const [position] = account.positions;
    if (position === undefined) throw new Error("no position");
    const falling = render({ account: { ...account, positions: [{ ...position, closeFee: { openedAt: 1_940_000, feeBps: 6_421, fallsAt: 2_000_005 } }] }, quotes: GAIN.quotes });
    expect(rows(falling)[0]?.[FEE_RATE]).toBe("64.21%Base in 14m 00sFalling to 10.00% in 14m 00s");
    expect(falling).toContain('<span aria-hidden="true">Base in 14m 00s</span><span class="sr-only">Falling to 10.00% in 14m 00s</span>');
  });
});

describe("a fee that may still change", () => {
  it("is an upper bound rounded up to the cent, never below the fee", () => {
    // 60 s after the open the rate is 64.21% and about to fall: 2 x (100,979.8 - 100,000) = $1,959.60, and 64.21% of it is $1,258.25916.
    const account = holding(2, 100_000);
    const [position] = account.positions;
    if (position === undefined) throw new Error("no position");
    const html = render({ account: { ...account, positions: [{ ...position, closeFee: { openedAt: 1_940_000, feeBps: 6_421, fallsAt: 2_000_005 } }] }, quotes: GAIN.quotes });
    expect(rows(html)[0]?.[FEE_USD]).toBe("≤ $1,258.26Close-out —");
  });
});

describe("a held market the node does not quote", () => {
  const unquoted = () => render({ account: holding(2, 100_000), quotes: {} });
  const left = (html: string) => html.match(/The following positions? (is|are) not included in Close all[^<]*/)?.[0];

  it("tells the desktop trader, in Close all's note, to select the market for its closing price", () => {
    expect(left(unquoted())).toBe("The following position is not included in Close all: BTC-USD (select it in the watchlist to load its closing price).");
  });

  it("does not say so of a market that is quoted, or of one the mock prices itself", () => {
    expect(left(render({ ...GAIN, quoted: [1] }))).toBeUndefined();
    expect(left(render({ ...GAIN, signatures: "none" }))).toBeUndefined();
  });
});

describe("the phone card's height", () => {
  /** The card's markup, with what a withheld figure and an unquoted market add: neither may add or remove an element. */
  const card = (html: string) => (html.split("<ul")[1] ?? "").split("</ul>")[0] ?? "";
  const shape = (html: string) => card(html).replace(/>[^<]*</g, "><").replace(/ (id|aria-describedby|aria-hidden)="[^"]*"/g, "").replace(/ (disabled|class)="[^"]*"/g, "");

  it("keeps the Close now figure's reason out of the card, in the row's explanation only", () => {
    const html = unquotedCard();
    expect(card(html)).not.toContain("The closing price for this position is still loading");
    expect(details(html)).toContain("Select BTC-USD in the watchlist to load its closing price.");
  });

  it("has the same elements whether or not a closing price has arrived, the select line mounted and hidden when it is not needed", () => {
    const quoted = render({ ...GAIN, quoted: [1] });
    expect(shape(unquotedCard())).toBe(shape(quoted));
    expect(card(quoted)).toContain('aria-hidden="true" class="mt-2 text-label invisible">Select BTC-USD in the watchlist to load its closing price.');
    expect(card(unquotedCard())).toContain('aria-hidden="false" class="mt-2 text-label text-fg-3">Select BTC-USD in the watchlist to load its closing price.');
  });
});

function unquotedCard() {
  return render({ account: holding(2, 100_000), quotes: {} });
}
