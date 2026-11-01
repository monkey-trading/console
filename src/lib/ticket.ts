/** What an order ticket shows before the user places the order: the quote, the margin it uses, the limits. */

import { absFixed, bpsOf, divFixed, fixedFromWire, mulFixed, parseFixed, type Fixed } from "./fixed";
import type { MarketView, Side } from "./engine/types";
import type { AccountModel, MarketModel } from "./models";
import { executionCost, growthOf, quoteOrder, slicedBps, tieredMargin, type Quote } from "./pricing";

/** The decimal places of a size: a millionth of a unit is the smallest step. */
export const QTY_PLACES = 6;

/** The ticket's own refusal of an order it cannot value in USD, which the node would decline for want of an FX price. */
export const NO_FX_PRICE = "No FX price yet, so this order's value in USD is unknown.";

/** What the size field holds: nothing yet, a quantity, or text the ticket refuses with the reason. */
export type SizeInput = { kind: "empty" } | { kind: "qty"; qty: Fixed } | { kind: "refused"; message: string };

/**
 * Reads the size field as the order's quantity, exactly as typed: a size finer than `QTY_PLACES`
 * decimal places is refused, never rounded. Trailing zeros past the step change no value and pass.
 */
export function parseSize(text: string): SizeInput {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (match === null) return { kind: "refused", message: "Enter the size in digits, such as 0.5 or 2.25." };
  const [, whole = "0", places = ""] = match;
  const fraction = places.replace(/0+$/, "");
  if (fraction.length > QTY_PLACES) return { kind: "refused", message: `A size has at most ${QTY_PLACES} decimal places.` };
  const qty = parseFixed(fraction === "" ? whole : `${whole}.${fraction}`);
  // The pattern admits only digits and at most nine places, so a parse failure is a broken invariant.
  if (qty === null) throw new Error(`size ${trimmed} matched the size pattern but did not parse`);
  return { kind: "qty", qty };
}

/** What one contract is: a unit of the market's base asset, or of the instrument itself when it has none. */
export function contractUnit(market: MarketModel): string {
  const [base = market.symbol, quote] = market.symbol.split("-");
  return quote === undefined ? `${base} unit` : base;
}

/**
 * `qty` units at `price` in USD, rounded down as the engine's check is (`execution/validation.rs`,
 * `execution/mod.rs`). A market quoted in another currency converts through its FX mark, the pair's
 * own listing (USD-JPY) at `price` itself; null when that mark is missing.
 */
function usdValue(view: MarketView, qty: Fixed, price: Fixed): Fixed | null {
  const amount = mulFixed(qty, price);
  const currency = view.quote_currency;
  if (currency === undefined) return amount;
  const fx = currency.fx_market === view.id ? price : view.fx_mark == null ? null : fixedFromWire(view.fx_mark);
  if (fx === null || fx <= 0n) return null;
  return currency.currency === "jpy" ? divFixed(amount, fx) : mulFixed(amount, fx);
}

/** The ticket's own margin refusal, which a live build leaves to the node's executable quote. */
export const MARGIN_SHORT = "Not enough equity for the margin this needs.";

/** The slippage bounds offered, in basis points. */
export const SLIPPAGE_CHOICES = [5, 10, 25, 50] as const;

/** The bound a market order is shown and signed with: the user's choice, never past the market's own, which the engine clamps to (`execution/mod.rs`). */
export function slippageBound(chosenBps: number, market: MarketModel): number {
  return Math.min(chosenBps, market.view.max_slippage_bps);
}

export interface TicketInput {
  market: MarketModel;
  side: Side;
  /** The order's quantity in units of the market, exactly as entered. */
  qty: Fixed;
  slippageBps: number;
  /** A limit or stop order, admitted without the margin and capacity checks that run when it triggers. */
  resting?: boolean;
  /** The price a resting order waits for; its minimum size is checked there. */
  triggerPrice?: Fixed | null;
  account: AccountModel | null;
  houseNav: Fixed;
  /** False for a live node, whose executable quote the console cannot know: the margin use, which depends on it, is then null. */
  estimates?: boolean;
}

export interface TicketPreview {
  /** The order's quantity, as given. */
  qty: Fixed;
  /** The order's value in USD at the price the minimum is checked at (the trigger price of a resting order, else the mark); null with no price or no FX price. */
  notional: Fixed | null;
  /** The order's value in USD at the mark, which margin and the house's cap are measured on. */
  markNotional: Fixed;
  /** The price the order would fill at now; this is sent as the order's quoted price. */
  quote: Quote | null;
  /** The best offer and bid for this size, and the spread between them in basis points of the index. */
  offer: Fixed | null;
  bid: Fixed | null;
  spreadBps: number;
  /** The worst price the slippage bound allows. */
  worstPrice: Fixed | null;
  /** Margin the whole account needs after this order. */
  marginAfter: Fixed;
  /** The extra margin this order needs. */
  marginAdded: Fixed;
  /** Margin over equity after the order, in basis points; null with no equity. */
  marginUseBps: number | null;
  /** The margin rate this size pays, in basis points of notional (the tiers' weighted rate). */
  marginRateBps: number;
  /** The resulting position's notional over its margin, to two places: every position gets its market's margin rate. */
  impliedLeverage: number | null;
  /** The house's cap on net notional in this market. */
  houseCap: Fixed;
  /** Reasons the order cannot be placed, shown beside the ticket. */
  problems: string[];
}

/** The signed quantity the account holds in the market. */
function held(account: AccountModel | null, id: number): Fixed {
  return account?.positions.find((p) => p.market === id)?.qty ?? 0n;
}

/**
 * Builds the preview for a market order.
 * Error cases: none; every refusal is listed in `problems`.
 */
export function previewTicket(input: TicketInput): TicketPreview {
  const { market, side, qty, account } = input;
  const spec = market.view;
  const mark = market.mark;
  const problems: string[] = [];
  const houseCap = bpsOf(input.houseNav, spec.house_cap_bps);
  if (mark === null || mark <= 0n) {
    return {
      qty, notional: null, markNotional: 0n, quote: null, offer: null, bid: null, spreadBps: 0, worstPrice: null, marginAfter: account?.margin ?? 0n, marginAdded: 0n,
      marginUseBps: null, marginRateBps: 0, impliedLeverage: null, houseCap, problems: ["No price yet."],
    };
  }
  const markNotional = mulFixed(qty, mark);
  const rate = slicedBps(spec.margin_tiers, 0n, markNotional);
  // The minimum is checked at the trigger price for a resting order and at the index for a fill.
  const notional = usdValue(spec, qty, input.resting && input.triggerPrice ? input.triggerPrice : mark);
  const current = held(account, market.id);
  const quoteSide = (s: Side) =>
    quoteOrder({ index: mark, side: s, baseSpreadBps: market.baseSpreadBps, spreadTiers: spec.spread_tiers, stress: market.stress, held: current, qty });
  const offer = quoteSide("buy");
  const bid = quoteSide("sell");
  const quote = side === "buy" ? offer : bid;
  const delta = side === "buy" ? qty : -qty;
  const grows = growthOf(current, delta).grows;
  const before = tieredMargin(spec.margin_tiers, mulFixed(current, mark));
  const after = tieredMargin(spec.margin_tiers, mulFixed(current + delta, mark));
  const marginAfter = (account?.margin ?? 0n) - before + after;
  // The rate the whole resulting position pays, the basis the required margin and the implied leverage use.
  const resulting = absFixed(mulFixed(current + delta, mark));
  const positionRate = resulting > 0n ? Number((after * 10_000n) / resulting) : rate;
  const equity = account?.equity ?? 0n;
  // The check the node runs: equity after the spread this fill pays, against the margin the account then needs.
  const cost = executionCost({ held: current, entry: account?.positions.find((p) => p.market === market.id)?.entry ?? null, delta, price: quote.price, index: mark });
  const afterCost = equity - cost;
  const useBps = afterCost > 0n ? Number((marginAfter * 10_000n) / afterCost) : equity > 0n ? 10_001 : null;
  const worst = side === "buy" ? bpsOf(quote.price, input.slippageBps) : -bpsOf(quote.price, input.slippageBps);
  if (!market.open && !input.resting) problems.push("This market is closed.");
  if (market.reduceOnly && grows) problems.push("This market only accepts orders that reduce a position.");
  if (qty <= 0n) problems.push("Enter a size.");
  else if (grows && notional === null) problems.push(NO_FX_PRICE);
  else if (grows && notional !== null && notional < fixedFromWire(spec.min_order_notional)) problems.push(`Minimum order is ${spec.min_order_notional} USD.`);
  if (grows && !input.resting) {
    if (equity <= 0n) problems.push("Fund your account to trade.");
    else if (marginAfter > afterCost) problems.push(MARGIN_SHORT);
  }
  return {
    qty, notional, markNotional, quote, offer: offer.price, bid: bid.price, spreadBps: Number(((offer.price - bid.price) * 10_000n) / mark), worstPrice: input.resting ? null : quote.price + worst,
    marginAfter, marginAdded: after - before, marginUseBps: input.estimates === false ? null : useBps, marginRateBps: positionRate,
    impliedLeverage: after > 0n ? Number((resulting * 100n) / after) / 100 : null, houseCap, problems,
  };
}
