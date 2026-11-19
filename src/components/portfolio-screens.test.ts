/**
 * Portfolio margin on the screens, rendered as markup (monkey-trading/console#445): an account that earns no offset sees the
 * account summary, the positions and the deal ticket exactly as without portfolio margin, and a hedge that earns one is
 * listed under its heading, with its offset in the summary and the ticket holding an order until the server previews it.
 */

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PortfolioGridWire } from "@/lib/engine/portfolio-types";
import { fixedFromInt } from "@/lib/fixed";
import type { AccountModel, MarketModel, PositionModel } from "@/lib/models";
import type { PortfolioModel } from "@/lib/portfolio";
import type { ConsoleState } from "@/lib/store/state";
import { btcAt } from "@/lib/ticket-fixtures";

import { AccountSummary } from "./AccountSummary";
import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { DealTicket } from "./DealTicket";
import { PositionsView } from "./PositionsView";

const btc = await btcAt(100_000);
const other = (id: number, symbol: string, mark: bigint): MarketModel => ({ ...btc, id, symbol, mark, view: { ...btc.view, id, symbol } });
const eth = other(2, "ETH-USD", fixedFromInt(4_000));
const eur = other(3, "EUR-USD", fixedFromInt(1));
const GRID: PortfolioGridWire = { groups: [{ name: "crypto", floor_share_bps: 5_000, max_floor_share_bps: 10_000, members: [{ market: 1, loading: "1", residual_shock_bps: 20, max_residual_shock_bps: 80 }, { market: 2, loading: "1.25", residual_shock_bps: 20, max_residual_shock_bps: 80 }] }] };
const held = (market: number, qty: number): PositionModel => ({ market, qty: fixedFromInt(qty), entry: fixedFromInt(qty > 0 ? 99_000 : 4_000), closeout: null, closeFee: null });
const account = (positions: PositionModel[], portfolio?: PortfolioModel): AccountModel => ({
  balance: fixedFromInt(10_000), unfinalised: 0n, equity: fixedFromInt(10_000), margin: fixedFromInt(1_500), positions, orders: [],
  requirements: { initialMargin: fixedFromInt(2_000), maintenanceMargin: fixedFromInt(750), withdrawable: fixedFromInt(8_000), maxLeverage: new Map() },
  ...(portfolio === undefined ? {} : { portfolio }),
});
/** One unhedged BTC-USD long, its group named with nothing matched, as a node with a grid reads it. */
const LONE: PortfolioModel = { margin: fixedFromInt(1_500), initialMargin: fixedFromInt(2_000), maintenanceMargin: fixedFromInt(750), groups: [{ name: "crypto", members: [1], netNotional: fixedFromInt(100_000), matchedNotional: 0n, offset: 0n }] };
/** A BTC-USD long hedged by an ETH-USD short, earning $1,000 off its $1,500 margin. */
const HEDGED: PortfolioModel = { margin: fixedFromInt(500), initialMargin: fixedFromInt(1_200), maintenanceMargin: fixedFromInt(250), groups: [{ name: "crypto", members: [1, 2], netNotional: fixedFromInt(50_000), matchedNotional: fixedFromInt(100_000), offset: fixedFromInt(1_000) }] };

function Seed({ patch }: { patch: Partial<ConsoleState> }) {
  const { store } = useSession();
  store.patch({ markets: [btc, eth, eur], selected: 1, signatures: "none", protocolVersion: 84, wallet: { address: "0x00000000000000000000000000000000000000aa", label: "test" }, ...patch });
  return null;
}
/** The screen's markup, its apostrophes as written. */
const render = (screen: ReactNode, patch: Partial<ConsoleState> = {}) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed, { patch }), screen)).replaceAll("&#x27;", "'");
const PARAMS = { profitFeeBps: 1_000, closeoutLevelBps: 5_000, totalCapBps: 20_000, totalCapFloor: 0n, stressLevels: [], profitFeeCurve: [], seq: 1 };
/** `patch` on a node whose parameters name the offset grid. */
const grid = (state: Partial<ConsoleState>, patch: Partial<ConsoleState>): Partial<ConsoleState> => ({ ...state, ...patch, houseParams: { ...PARAMS, portfolioGrid: GRID } });

describe("an account that earns no offset", () => {
  const screens = [AccountSummary, PositionsView, DealTicket];

  it("sees the summary, the positions and the ticket exactly as without portfolio margin", () => {
    for (const screen of screens) {
      const without = render(createElement(screen), { account: account([held(1, 1)]), houseParams: PARAMS });
      expect(render(createElement(screen), grid({}, { account: account([held(1, 1)], LONE) }))).toBe(without);
    }
  });

  it("sees no hedge heading, offset line or trigger note, and its Close-out help is the per-position one", () => {
    const html = render(createElement(PositionsView), grid({}, { account: account([held(1, 1), held(3, 1_000)], LONE) })) + render(createElement(AccountSummary), grid({}, { account: account([held(1, 1)], LONE) }));
    for (const text of ["Hedge:", "Close hedge", "Margin offset", "Other positions", "hedged positions", "hedge each other"]) expect(html).not.toContain(text);
  });
});

describe("an account whose hedge earns an offset", () => {
  const hedged = grid({}, { account: account([held(1, 1), held(2, -10), held(3, 1_000)], HEDGED) });

  it("lists the hedge's positions under its heading, with its net exposure, offset and Close hedge, and the rest after it", () => {
    const html = render(createElement(PositionsView), hedged);
    expect(html).toContain("Hedge: BTC-USD and ETH-USD");
    expect(html).toContain("$50,000.00 long");
    expect(html).toContain("$1,000.00");
    expect(html).toMatch(/<button type="button"[^>]*aria-label="Close hedge: BTC-USD and ETH-USD"[^>]*>Close hedge<\/button>/);
    // In the table, the hedge's rows come first and EUR-USD under Other positions.
    const table = html.slice(html.indexOf("<table"));
    expect([table.indexOf("Hedge: BTC-USD"), table.indexOf(">BTC-USD</span>"), table.indexOf(">ETH-USD</span>"), table.indexOf("Other positions"), table.indexOf(">EUR-USD</span>")].every((at, i, all) => at > (all[i - 1] ?? -1))).toBe(true);
  });

  it("says when a position of the hedge cannot be traded, which Close hedge leaves open", () => {
    const html = render(createElement(PositionsView), { ...hedged, markets: [btc, { ...eth, open: false }, eur] });
    expect(html).toContain("ETH-USD cannot be traded at present, so Close hedge leaves it open. Until it can be traded again, this hedge does not reduce the margin required for new orders or withdrawals.");
  });

  it("disables a hedged position's Close, saying why at it, when the node's exact close quote declines it for margin", () => {
    const declined = { kind: "insufficient_margin" as const, equity: "100", required: "200" };
    const quote = { type: "quote" as const, account: "0xaa", market: 2, open: true, reduce_only: false, stress_level: 0, mark: "4000", ask: [], bid: [], close: { side: "buy" as const, qty: "10", price: "4001", declined } };
    const html = render(createElement(PositionsView), { ...hedged, signatures: "checked", quoted: [1, 2], quotes: { 2: quote } });
    const note = "Closing ETH-USD on its own would raise your initial margin above your equity, so the order would be rejected. Close hedge closes all of the hedge's positions together.";
    expect(html).toContain(note);
    const id = html.match(/<td id="([^"]+)" colSpan="8"[^>]*><p class="max-w-\[80ch\] whitespace-normal">Closing ETH-USD/)?.[1];
    expect(html).toMatch(new RegExp(`<button type="button" disabled="" class="[^"]*" aria-label="Close ETH-USD position" aria-describedby="${id}">Close</button>`));
    expect(render(createElement(PositionsView), { ...hedged, signatures: "checked", quoted: [1, 2], quotes: { 2: { ...quote, close: { ...quote.close, declined: undefined } } } })).not.toContain(note);
  });

  it("states the offset and the close-out level in the summary", () => {
    expect(render(createElement(AccountSummary), hedged)).toContain("Your hedged positions reduce your margin from $1,500.00 to $500.00. Your account will be closed out if its equity falls below $250.00.");
  });

  it("holds an order in the hedge, its line's height kept, until the server's preview of its size arrives", () => {
    const html = render(createElement(DealTicket), hedged);
    expect(html).toMatch(/aria-describedby="[^"]*-size-note [^"]*-hedge [^"]*-size-problems"/);
    expect(html).toMatch(/<button type="submit" aria-disabled="true"/);
    expect(render(createElement(DealTicket), grid({}, { account: account([held(1, 1)], LONE) }))).not.toContain("-hedge");
  });
});
