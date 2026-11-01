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
  positions: qty === 0n ? [] : [{ market: 1, qty, entry: fixedFromInt(60_000) }], orders,
});

const withAccount = (base: ConsoleState, a: AccountModel, signatures: ConsoleState["signatures"] = "none"): ConsoleState => ({ ...base, signatures, account: a });

describe("markersFor", () => {
  it("draws a buy order green and a sell order red, for limit and stop alike", async () => {
    const { market, base } = await fixture();
    const orders = [order(1, "buy", "limit"), order(2, "sell", "limit"), order(3, "buy", "stop"), order(4, "sell", "stop")];
    const lines = markersFor(withAccount(base, account(0n, orders)), market);
    expect(lines.map((l) => [l.title, l.tone])).toEqual([
      ["limit buy", "glow"], ["limit sell", "ember"], ["stop buy", "glow"], ["stop sell", "ember"],
    ]);
    expect(lines.every((l) => l.style === "dotted")).toBe(true);
  });

  it("draws the entry neutral on a long and on a short", async () => {
    const { market, base } = await fixture();
    for (const [qty, title] of [[fixedFromInt(1), "Long entry"], [fixedFromInt(-1), "Short entry"]] as const) {
      const entry = markersFor(withAccount(base, account(qty, [])), market).find((l) => l.title === title);
      expect(entry).toMatchObject({ price: 60_000, tone: "fg-2", style: "dotted" });
    }
  });

  it("keeps the close-out red and dashed on either side, apart from a sell order by style and title", async () => {
    const { market, base } = await fixture();
    for (const qty of [fixedFromInt(1), fixedFromInt(-1)]) {
      const lines = markersFor(withAccount(base, account(qty, [order(1, "sell", "limit")])), market);
      const closeOut = lines.find((l) => l.title === "Close-out (est.)");
      expect(closeOut).toMatchObject({ tone: "ember", style: "dashed" });
      expect(lines.find((l) => l.title === "limit sell")?.style).toBe("dotted");
    }
  });

  it("draws no close-out against a live node, no market order, and no other market's order", async () => {
    const { market, base } = await fixture();
    const marketOrder: RestingOrder = { ...order(1, "buy", "limit"), kind: { kind: "market", quoted: "60000" } };
    const lines = markersFor(withAccount(base, account(fixedFromInt(1), [marketOrder, order(2, "buy", "limit", 2)]), "checked"), market);
    expect(lines.map((l) => l.title)).toEqual(["Long entry"]);
    expect(markersFor(base, market)).toEqual([]);
  });
});
