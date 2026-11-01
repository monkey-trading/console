/** Shared markets, accounts and sizes for the ticket's tests. */

import { fixedFromInt, parseFixed } from "./fixed";
import type { MarketView } from "./engine/types";
import { decodeMarket, type AccountModel, type MarketModel } from "./models";
import { createMockNode } from "./mock";

const START = Date.UTC(2026, 9, 28, 15, 0, 0);

export async function btc() {
  const node = createMockNode(START);
  const view = (await node.client.markets()).find((m) => m.symbol === "BTC-USD");
  if (!view) throw new Error("BTC-USD is listed");
  return decodeMarket(view, undefined, true);
}

export const account = (equity: number, margin = 0): AccountModel => ({
  balance: fixedFromInt(equity), unfinalised: 0n, equity: fixedFromInt(equity), margin: fixedFromInt(margin), positions: [], orders: [],
});

export const q = (text: string) => parseFixed(text) ?? 0n;
export const NAV = fixedFromInt(20_000_000);

/** BTC-USD at a round mark, so a quantity's value is easy to read. */
export async function btcAt(mark: number | string): Promise<MarketModel> {
  return { ...(await btc()), mark: typeof mark === "number" ? fixedFromInt(mark) : q(mark) };
}

/** A market quoted in another currency, listed as the node serves it: `fx_mark` converts it, $100 minimum. */
export async function quotedIn(currency: "eur" | "gbp" | "jpy", mark: number | string, fxMark: string | null, fxMarket = 3): Promise<MarketModel> {
  const base = await btcAt(mark);
  const view: MarketView = { ...base.view, id: 9, quote_currency: { currency, fx_market: fxMarket }, fx_mark: fxMark };
  return { ...base, id: 9, view };
}

export const heldIn = (market: MarketModel, qty: string): AccountModel => ({ ...account(10_000), positions: [{ market: market.id, qty: q(qty), entry: market.mark ?? 0n }] });
