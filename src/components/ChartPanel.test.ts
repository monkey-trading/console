/** Tests for the lines the chart draws across a market. */

import { describe, expect, it } from "vitest";

import type { RestingOrder, Side } from "@/lib/engine/types";
import { fixedFromInt } from "@/lib/fixed";
import { decodeMarket, type AccountModel } from "@/lib/models";
import { createMockNode } from "@/lib/mock";
import { initialState, type ConsoleState } from "@/lib/store/state";

import { markersFor } from "./ChartPanel";

const START = Date.UTC(2026, 9, 28, 15, 0, 0);

async function fixture() {
  const node = createMockNode(START);
  const views = await node.client.markets();
  const market = views.map((v) => decodeMarket(v, undefined, true)).find((m) => m.id === 1);
  if (!market) throw new Error("BTC-USD is listed");
  const base = initialState(views, { cash: "0", nav: "0", gross_exposure: "0" }, START, () => [], "none");
  return { market, base };
}

const order = (id: number, side: Side, kind: "limit" | "stop", market = 1): RestingOrder => ({
  order_id: id, client_id: id, market, side, qty: "1", kind: { kind, price: String(60_000 + id) }, reduce_only: false,
});

const account = (qty: bigint, orders: RestingOrder[]): AccountModel => ({
  balance: fixedFromInt(1_000), unfinalised: 0n, equity: fixedFromInt(1_000), margin: fixedFromInt(400),
  positions: qty === 0n ? [] : [{ market: 1, qty, entry: fixedFromInt(60_000), closeout: { reach: "at", price: fixedFromInt(qty > 0n ? 59_000 : 61_000) }, closeFee: null }], orders,
});

const withAccount = (base: ConsoleState, a: AccountModel): ConsoleState => ({ ...base, account: a });

describe("markersFor", () => {
  it("draws a buy order green and a sell order red, for limit and stop alike", async () => {
    const { market, base } = await fixture();
    const orders = [order(1, "buy", "limit"), order(2, "sell", "limit"), order(3, "buy", "stop"), order(4, "sell", "stop")];
    const lines = markersFor(withAccount(base, account(0n, orders)), market);
    expect(lines.map((l) => [l.title, l.tone])).toEqual([
      ["Limit buy", "glow"], ["Limit sell", "ember"], ["Stop buy", "glow"], ["Stop sell", "ember"],
    ]);
    expect(lines.every((l) => l.style === "dotted")).toBe(true);
  });

  it("draws a long's entry green and a short's entry red", async () => {
    const { market, base } = await fixture();
    for (const [qty, title, tone] of [[fixedFromInt(1), "Long entry", "glow"], [fixedFromInt(-1), "Short entry", "ember"]] as const) {
      const entry = markersFor(withAccount(base, account(qty, [])), market).find((l) => l.title === title);
      expect(entry).toMatchObject({ price: 60_000, tone, style: "dotted" });
    }
  });

  it("draws the close-out grey and dashed at the node's price on either side, apart from a sell order by style and title", async () => {
    const { market, base } = await fixture();
    for (const [qty, price] of [[fixedFromInt(1), 59_000], [fixedFromInt(-1), 61_000]] as const) {
      const lines = markersFor(withAccount(base, account(qty, [order(1, "sell", "limit")])), market);
      const closeOut = lines.find((l) => l.title === "Close-out");
      expect(closeOut).toMatchObject({ price, tone: "fg-3", style: "dashed" });
      expect(lines.find((l) => l.title === "Limit sell")?.style).toBe("dotted");
    }
  });

  it("draws no market order, and no other market's order", async () => {
    const { market, base } = await fixture();
    const marketOrder: RestingOrder = { ...order(1, "buy", "limit"), kind: { kind: "market", quoted: "60000" } };
    const lines = markersFor(withAccount(base, account(fixedFromInt(1), [marketOrder, order(2, "buy", "limit", 2)])), market);
    expect(lines.map((l) => l.title)).toEqual(["Long entry", "Close-out"]);
    expect(markersFor(base, market)).toEqual([]);
  });

  it("with lines off leaves out the entry and the resting orders and keeps the close-out", async () => {
    const { market, base } = await fixture();
    const held = withAccount(base, account(fixedFromInt(1), [order(1, "sell", "limit")]));
    const titles = (lines: boolean) => markersFor(held, market, lines).map((l) => l.title);
    expect(titles(true)).toEqual(expect.arrayContaining(["Long entry", "Limit sell", "Close-out"]));
    expect(titles(false)).toEqual(["Close-out"]);
    expect(markersFor(withAccount(base, account(0n, [order(1, "sell", "limit")])), market, false)).toEqual([]);
  });

  it("draws the take profit green and the stop loss red, solid, on a long or a short, and neither with lines off", async () => {
    const { market, base } = await fixture();
    for (const [qty, take, stop] of [[fixedFromInt(1), 62_000, 58_500], [fixedFromInt(-1), 58_000, 61_500]] as const) {
      const held = account(qty, []);
      const position = held.positions[0];
      if (position === undefined) throw new Error("no position");
      const state = withAccount(base, { ...held, positions: [{ ...position, levels: { takeProfit: fixedFromInt(take), stopLoss: fixedFromInt(stop) } }] });
      const levels = markersFor(state, market).filter((l) => l.style === "solid");
      expect(levels).toEqual([{ price: take, tone: "glow", style: "solid", title: "Take profit" }, { price: stop, tone: "ember", style: "solid", title: "Stop loss" }]);
      expect(markersFor(state, market, false).map((l) => l.title)).toEqual(["Close-out"]);
    }
  });

  it("draws one level alone, and no line for a level another market's position holds", async () => {
    const { market, base } = await fixture();
    const held = account(fixedFromInt(1), []);
    const position = held.positions[0];
    if (position === undefined) throw new Error("no position");
    const stopOnly = withAccount(base, { ...held, positions: [{ ...position, levels: { takeProfit: null, stopLoss: fixedFromInt(58_000) } }] });
    expect(markersFor(stopOnly, market).map((l) => l.title)).toEqual(["Long entry", "Stop loss", "Close-out"]);
    const elsewhere = withAccount(base, { ...held, positions: [{ ...position, market: 2, levels: { takeProfit: fixedFromInt(1), stopLoss: null } }] });
    expect(markersFor(elsewhere, market)).toEqual([]);
  });
});
