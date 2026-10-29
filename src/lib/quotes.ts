/**
 * Reading the node's executable quotes (the signed stream's `quotes` op, monkey-trading/engine#290):
 * which markets the console asks about, and the price a given order takes from a market's steps.
 */

import type { MarketId, MarketQuote, Reject, Side } from "./engine/types";
import { fixedFromWire, type Fixed } from "./fixed";
import { describeReject } from "./messages";
import type { TicketPreview } from "./ticket";

/** The most markets one connection may ask quotes for: the node's `api.quote_max_markets` default. */
export const MAX_QUOTED_MARKETS = 4;

/** The price an order takes from a quote, and why the node would decline it, if it would. */
export interface ExecutablePrice {
  price: Fixed;
  declined: Reject | null;
}

/**
 * The markets to ask quotes for: the selected one first, then those the account holds positions
 * in, for their closing prices, up to the node's limit.
 */
export function quoteMarkets(selected: MarketId, held: readonly MarketId[]): MarketId[] {
  return [...new Set([selected, ...held])].slice(0, MAX_QUOTED_MARKETS);
}

/**
 * The price an order of `qty` on `side` takes: that of the first step whose size covers it, as the
 * engine's quote ladder defines it. Null when the market has no price or the order is larger than
 * every step, so the node would not open it.
 */
export function executablePrice(quote: MarketQuote, side: Side, qty: Fixed): ExecutablePrice | null {
  const steps = side === "buy" ? quote.ask : quote.bid;
  const step = steps.find((s) => fixedFromWire(s.qty) >= qty);
  return step === undefined ? null : { price: fixedFromWire(step.price), declined: step.declined ?? null };
}

/** The price of closing the account's whole position from the quote's `close`, when it closes exactly `qty` on `side`. */
export function closingPrice(quote: MarketQuote, side: Side, qty: Fixed): Fixed | null {
  const close = quote.close;
  return close !== null && close.side === side && fixedFromWire(close.qty) === qty ? fixedFromWire(close.price) : null;
}

/** What the deal ticket shows and sends: the bid and offer for the order's size, the price on its side, and why there is none. */
export interface TicketPrices {
  bid: Fixed | null;
  offer: Fixed | null;
  /** The price a market order is sent with as its quoted price. */
  price: Fixed | null;
  /** The offer over the bid, in basis points of the mark. */
  spreadBps: number | null;
  /** Why a market order cannot be sent at a price now; null when it can. */
  problem: string | null;
}

/**
 * The ticket's prices. A live node's come from its executable quote for the connected account and
 * this size, which already counts the account's toxicity, position and margin; the mock's are the
 * console's own estimate.
 */
export function ticketPrices(input: { live: boolean; quote: MarketQuote | null; quoteError: string | null; preview: TicketPreview; side: Side; mark: Fixed | null }): TicketPrices {
  const { preview, side } = input;
  if (!input.live) {
    return { bid: preview.bid, offer: preview.offer, price: preview.quote?.price ?? null, spreadBps: preview.spreadBps, problem: null };
  }
  const none = (problem: string): TicketPrices => ({ bid: null, offer: null, price: null, spreadBps: null, problem });
  const { quote } = input;
  if (quote === null) return none(input.quoteError === null ? "Waiting for the node's executable quote." : "The node quotes an account once it has credited it: deposit and declare your eligibility first.");
  if (quote.unavailable !== undefined) return none(describeReject(quote.unavailable));
  const ask = executablePrice(quote, "buy", preview.qty);
  const bid = executablePrice(quote, "sell", preview.qty);
  const mine = side === "buy" ? ask : bid;
  const spreadBps = ask !== null && bid !== null && input.mark !== null && input.mark > 0n ? Number(((ask.price - bid.price) * 10_000n) / input.mark) : null;
  const problem = mine === null ? "The node would not open an order this large. Try a smaller size." : mine.declined === null ? null : describeReject(mine.declined);
  return { bid: bid?.price ?? null, offer: ask?.price ?? null, price: mine?.price ?? null, spreadBps, problem };
}
