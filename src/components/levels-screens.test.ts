/** Tests for where levels show: the deal ticket's fields, the position row and its editor, and the working orders that carry them. */

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { fixedFromInt, parseFixed } from "@/lib/fixed";
import type { AccountModel, MarketModel, PositionModel } from "@/lib/models";
import type { ConsoleState } from "@/lib/store/state";
import { btcAt } from "@/lib/ticket-fixtures";

import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { DealTicket } from "./DealTicket";
import { LevelsEditor } from "./LevelsEditor";
import { OrdersView } from "./OrdersView";
import { PositionsView } from "./PositionsView";

const market = await btcAt(100_000);
/** BTC-USD as a node that predates V79 lists it: no minimum level distance. */
const older: MarketModel = { ...market, view: { ...market.view, min_level_distance_bps: undefined } };
const position: PositionModel = { market: 1, qty: fixedFromInt(1), entry: fixedFromInt(99_000), closeout: null, closeFee: null, levels: { takeProfit: fixedFromInt(102_000), stopLoss: fixedFromInt(97_500) } };
const account = (positions: PositionModel[], orders: AccountModel["orders"] = []): AccountModel => ({ balance: fixedFromInt(10_000), unfinalised: 0n, equity: fixedFromInt(10_000), margin: 0n, positions, orders });
/** The levels column's bounded width, inside which a long level wraps. */
const LEVEL = "max-w-[12ch] whitespace-normal [overflow-wrap:anywhere]";

function Seed({ patch }: { patch: Partial<ConsoleState> }) {
  const { store } = useSession();
  store.patch({ markets: [market], selected: 1, signatures: "none", ...patch });
  return null;
}
/** The screen's markup, its apostrophes as written. */
const render = (screen: ReactNode, patch: Partial<ConsoleState> = {}) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed, { patch }), screen)).replaceAll("&#x27;", "'");

describe("the deal ticket's levels", () => {
  it("offers a take profit and a stop loss field, with how they work, in a market that takes levels", () => {
    const html = render(createElement(DealTicket));
    expect(html).toContain(">Take profit and stop loss (optional)</button>");
    expect(html).toMatch(/<label[^>]*>Take profit<\/label><input/);
    expect(html).toMatch(/<label[^>]*>Stop loss<\/label><input/);
    expect(html).toContain("A take profit or stop loss closes your entire position when the price at which it would close reaches the level you set.");
    expect(html).toContain("Both differ from a stop order, which opens or adds to a position when the market's reference price reaches its trigger price.");
  });

  it("says what its fields do to a position already held, only while one is", () => {
    expect(render(createElement(DealTicket), { account: account([]) })).not.toContain("replaces the position's current level");
    expect(render(createElement(DealTicket), { account: account([position]) })).toContain("This order adds to your position. Each level entered here replaces the position's current level, and a field left empty keeps the current level.");
  });

  it("shows no level fields in a market listed by a node that predates them", () => {
    expect(render(createElement(DealTicket), { markets: [older] })).not.toContain("Take profit");
  });

  it("shows no level fields, nor the market's distance, before the node runs V79, though the listing names a distance", () => {
    const html = render(createElement(DealTicket), { protocolVersion: 78 });
    expect(html).not.toContain("Take profit");
    expect(html).not.toContain("Minimum distance for take profit and stop loss");
    expect(render(createElement(DealTicket), { protocolVersion: 79 })).toContain("Minimum distance for take profit and stop loss");
  });
});

describe("the position row's levels", () => {
  const CHANGE = "Change take profit and stop loss for your BTC-USD long position: take profit 102,000.00, stop loss 97,500.00";
  const ADD = "Add take profit and stop loss for your BTC-USD long position";
  /** The table's first row, and each control on the page that opens the levels editor, by its name and what it shows. */
  const row = (html: string) => (html.split("<tbody>")[1] ?? "").split("</tr>")[0] ?? "";
  const controls = (html: string) => [...html.matchAll(/<button type="button" id="[^"]*-levels-control-[^"]*"[^>]*aria-label="([^"]*)"[^>]*>(.*?)<\/button>/g)].map((m) => [m[1], m[2]?.replace(/<[^>]*>/g, "|")]);

  it("shows the take profit over the stop loss as the one control that opens the editor, named for the position, in the table and on the card", () => {
    const html = render(createElement(PositionsView), { account: account([position]) });
    expect(row(html)).toContain(`aria-expanded="false" aria-label="${CHANGE}" class="`);
    expect(row(html)).toContain(`><span class="block ${LEVEL}">102,000.00</span><span class="block min-h-lh text-label ${LEVEL}">97,500.00</span></button>`);
    expect(controls(html)).toEqual([[CHANGE, "102,000.00 / 97,500.00"], [CHANGE, "|102,000.00||97,500.00|"]]);
    expect(html).toMatch(/<dt[^>]*>(?:<[^>]*>)*Take profit \/ Stop loss<\/button>.*?<\/dt><dd class="mt-1.5"><button/);
  });

  it("names a level not set as none, and shows a dash for it", () => {
    const html = render(createElement(PositionsView), { account: account([{ ...position, levels: { takeProfit: null, stopLoss: fixedFromInt(97_500) } }]) });
    const name = "Change take profit and stop loss for your BTC-USD long position: no take profit, stop loss 97,500.00";
    expect(controls(html)).toEqual([[name, "— / 97,500.00"], [name, "|—||97,500.00|"]]);
    const short = render(createElement(PositionsView), { account: account([{ ...position, qty: fixedFromInt(-1), levels: { takeProfit: fixedFromInt(97_000), stopLoss: null } }]) });
    expect(controls(short)[0]?.[0]).toBe("Change take profit and stop loss for your BTC-USD short position: take profit 97,000.00, no stop loss");
  });

  it("shows Add for a position with none, keeping the cell's second line, and nothing beside Close", () => {
    const html = render(createElement(PositionsView), { account: account([{ ...position, levels: undefined }]) });
    expect(controls(html)).toEqual([[ADD, "Add"], [ADD, "Add"]]);
    expect(row(html)).toMatch(/>Add<\/button><span class="block min-h-lh text-label"><\/span><\/td>/);
    expect(row(html)).toMatch(/aria-label="Close BTC-USD position"[^>]*>Close<\/button><\/td>$/);
    expect(html).not.toContain("Edit");
  });

  it("shows a level of the most digits the engine accepts whole, wrapping inside the column's bounded width, so the table keeps to the 740 px pane", () => {
    const longest = { takeProfit: parseFixed("999999999.999999999") ?? 0n, stopLoss: parseFixed("1.000000001") ?? 0n };
    const html = render(createElement(PositionsView), { account: account([{ ...position, levels: longest }]) });
    expect(row(html)).toContain(`<span class="block ${LEVEL}">999,999,999.999999999</span><span class="block min-h-lh text-label ${LEVEL}">1.000000001</span>`);
    expect(html).toMatch(/class="[^"]*\[overflow-wrap:anywhere\][^"]*">999,999,999\.999999999 \/ 1\.000000001<\/button>/);
  });

  it("shows dashes and no control from a node that predates levels", () => {
    const dashes = `<span class="block ${LEVEL}">—</span><span class="block min-h-lh text-label text-fg-3 ${LEVEL}"><span class="sr-only">Stop loss </span>—</span>`;
    const old = render(createElement(PositionsView), { markets: [older], account: account([position]) });
    expect(old).toContain(dashes);
    expect(old).not.toContain("102,000.00");
    expect(controls(old)).toEqual([]);
    expect(old).not.toContain("take profit and stop loss for");
    expect(old).not.toMatch(/<dt[^>]*>(?:<[^>]*>)*Take profit/);
  });

  it("offers no control before the node runs V79, though the market's listing names a distance", () => {
    const html = render(createElement(PositionsView), { account: account([{ ...position, levels: undefined }]), protocolVersion: 78 });
    expect(controls(html)).toEqual([]);
    expect(controls(render(createElement(PositionsView), { account: account([{ ...position, levels: undefined }]), protocolVersion: 79 }))).toEqual([[ADD, "Add"], [ADD, "Add"]]);
  });
});

describe("a levels request's answer with no editor open", () => {
  it("is shown above the positions, or under the empty list once the position is gone, so a refusal is never lost", () => {
    const shown = (positions: PositionModel[]) => render(createElement(PositionsView), { account: account(positions), notices: { levels: { id: 1, text: "A refusal the trader must read.", tone: "error" } } });
    expect(shown([position])).toMatch(/role="alert"[^>]*>(?:(?!<\/div>).)*A refusal the trader must read\./);
    const empty = shown([]);
    expect(empty).toMatch(/role="alert"[^>]*><p[^>]*>A refusal the trader must read\./);
    expect(empty.indexOf("You have no open positions.")).toBeLessThan(empty.indexOf("A refusal the trader must read."));
  });
});

describe("a read-only account's positions", () => {
  it("offer no editor: the levels and Add are unavailable and say why, the levels shown as plain text", () => {
    const watched = { wallet: { address: "0xabc", label: "Watched", readOnly: true } };
    const html = render(createElement(PositionsView), { account: account([position]), ...watched });
    expect(html).toContain("Closing a position or editing its take profit and stop loss is unavailable because you are viewing this account in read-only mode.");
    expect(html).toMatch(/<button type="button" id="[^"]*-levels-control-1" disabled="" aria-describedby="[^"]+"[^>]*disabled:text-inherit disabled:no-underline[^>]*><span[^>]*>102,000.00</);
    expect(render(createElement(PositionsView), { account: account([{ ...position, levels: undefined }]), ...watched })).toMatch(/<button type="button" id="[^"]*-levels-control-1" disabled="" aria-describedby="[^"]+"[^>]*>Add<\/button>/);
  });
});

describe("Market info's minimum distance", () => {
  it("holds its explanation inside the term's definition, and none in a market that takes no levels", () => {
    expect(render(createElement(DealTicket))).toMatch(/<dt[^>]*>Minimum distance for take profit and stop loss<\/dt><dd[^>]*>0\.3%<span[^>]*>A take profit or stop loss must be set at least 0\.3% away/);
    expect(render(createElement(DealTicket), { markets: [older] })).not.toContain("Minimum distance for take profit and stop loss");
  });
});

describe("the levels editor", () => {
  const editor = (patch: Partial<Parameters<typeof LevelsEditor>[0]> = {}) => createElement(LevelsEditor, {
    id: "editor", market, position, fields: { takeProfit: "102000", stopLoss: "97500" }, onChange: () => undefined, closing: fixedFromInt(99_980), noClosing: "No closing price is available.", capped: null, limits: null, toUsdDown: (x) => x,
    onCancel: () => undefined, onSend: () => undefined, onSaved: () => undefined, saving: false, onSettled: () => undefined, readOnly: false, describedBy: undefined, onRemovedWithFocus: () => undefined, ...patch,
  });

  it("opens with the position's levels, their estimates and the closing price they are measured from, and offers no save until they change", () => {
    const html = render(editor());
    expect(html).toContain('value="102000"');
    expect(html).toContain('value="97500"');
    expect(html).toContain("Estimated profit $3,000.00 for the whole position, before the profit fee");
    expect(html).toContain("Estimated loss $1,500.00 for the whole position, before the profit fee, not guaranteed");
    expect(html).toContain("The price at which your entire position would close is currently 99,980.00. A new or moved take profit must be at least 0.3% above that closing price, and a new or moved stop loss at least 0.3% below it.");
    expect(html).toMatch(/<button type="submit" aria-disabled="true"[^>]*>Save<\/button>/);
    expect(html).toContain("Leave a field empty to remove that level.");
  });

  it("says a take profit is measured from the market price while the closing price is an estimate", () => {
    const html = render(editor({ capped: fixedFromInt(100_000) }));
    expect(html).toContain("The price at which your entire position would close is currently estimated at 99,980.00. A new or moved stop loss must be at least 0.3% below that closing price. While the closing price is an estimate, a new or moved take profit must be at least 0.3% above the market price, which is currently 100,000.00.");
  });

  it("keeps Cancel and Save from acting while a request is signed and sent, so its answer shows in the editor", () => {
    const html = render(editor({ fields: { takeProfit: "102000", stopLoss: "98000" } }), { busy: true });
    // Save says it is signing only for its own request; while another is signed it is simply unavailable.
    expect(html).toMatch(/<button type="submit" aria-disabled="true"[^>]*>Save<\/button>/);
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>Cancel<\/button>/);
  });

  it("holds Save from the press until its own save has finished, its account read included, though the session is no longer busy", () => {
    const moved = { fields: { takeProfit: "102000", stopLoss: "98000" } };
    expect(render(editor(moved))).toMatch(/<button type="submit" aria-disabled="false"[^>]*>Save<\/button>/);
    expect(render(editor({ ...moved, saving: true }), { busy: false })).toMatch(/<button type="submit" aria-disabled="true"[^>]*>Signing…<\/button>/);
  });

  it("hosts its own notice, read out as an alert for a failure and as a status otherwise", () => {
    function Notify({ tone }: { tone: "error" | "info" }) {
      const { store } = useSession();
      store.notify("levels", "A message the trader must read.", tone);
      return null;
    }
    const shown = (tone: "error" | "info") => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Notify, { tone }), editor()));
    expect(shown("error")).toMatch(/role="alert"[^>]*>(?:(?!<\/div>).)*A message the trader must read\./);
    expect(shown("info")).toMatch(/role="status"[^>]*>(?:(?!<\/div>).)*A message the trader must read\./);
  });
});

describe("a working order's levels", () => {
  it("shows the take profit and stop loss the order attaches when it fills, and a dash for one it names none", () => {
    const orders: AccountModel["orders"] = [
      { order_id: 7, client_id: 1, market: 1, side: "buy", qty: "0.1", kind: { kind: "limit", price: "95000" }, reduce_only: false, take_profit: "98000", stop_loss: "93000.5" },
      { order_id: 8, client_id: 2, market: 1, side: "buy", qty: "0.1", kind: { kind: "limit", price: "94000" }, reduce_only: false },
    ];
    const html = render(createElement(OrdersView), { account: account([], orders) });
    const rows = (html.split("<tbody>")[1] ?? "").split("</tr>").map((row) => row.replace(/<[^>]*>/g, "|").split("|").filter((cell) => cell !== ""));
    expect(rows[0]).toEqual(["7", "BTC-USD", "Buy", "limit", "0.100000", "95,000.00", "98,000.00", "93,000.50", "Cancel"]);
    expect(rows[1]).toEqual(["8", "BTC-USD", "Buy", "limit", "0.100000", "94,000.00", "—", "—", "Cancel"]);
  });
});
