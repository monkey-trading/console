/** What an order ticket shows before the user places the order: the quote, the margin it uses, the limits. */

import { absFixed, bpsOf, divFixed, fixedFromWire, fixedToWire, mulFixed, parseFixed, SCALE, type Fixed } from "./fixed";
import { capFor } from "./house";
import type { MarketView, Side } from "./engine/types";
import type { AccountModel, MarketModel } from "./models";
import { executionCost, growthOf, quoteOrder, slicedBps, tieredMargin, type Quote } from "./pricing";

/** The decimal places of a size: a millionth of a unit is the smallest step. */
const QTY_PLACES = 6;
const QTY_STEP: Fixed = SCALE / 1_000_000n;

/** The ticket's own refusal of an order it cannot value in USD, which the node would decline for want of an FX price. */
export const NO_FX_PRICE = "No FX price yet, so this order's value in USD is unknown.";

/** The note an order with no size gets, which a size the field itself refuses does not repeat: a prompt under the field, not an error. */
export const NO_SIZE = "Enter a size";

/** The refusal of a size under the market's minimum order value, given the spec's `min_order_notional`. */
export const belowMinimum = (minOrderNotional: string) => `Minimum order is ${minOrderNotional} USD.`;

/** The refusal of a resting order's trigger price that is not above zero. */
export const TRIGGER_NOT_POSITIVE = "Enter a trigger price above zero.";

/** The ticket's own margin refusal, which a live build leaves to the node's executable quote. */
export const MARGIN_SHORT = "Not enough equity for the margin this needs.";

/** The slippage bounds offered, in basis points. */
export const SLIPPAGE_CHOICES = [5, 10, 25, 50] as const;

/** What the size field holds: nothing yet, a quantity, or text the ticket refuses with the reason. */
export type SizeInput = { kind: "empty" } | { kind: "qty"; qty: Fixed } | { kind: "refused"; message: string };

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
  /** The order's value in USD at the price the minimum is checked at (the trigger price of a resting order, else the mark); null with no price. */
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
  /** The margin rate this size pays, in basis points of notional (the tiers' weighted rate); null before any size or position. */
  marginRateBps: number | null;
  /** The resulting position's notional over its margin, to two places: every position gets its market's margin rate. */
  impliedLeverage: number | null;
  /** The house's cap on net notional in this market. */
  houseCap: Fixed;
  /** Reasons the order cannot be placed, shown beside the ticket. */
  problems: string[];
}

/**
 * Reads the size field as the order's quantity, exactly as typed: a size finer than `QTY_PLACES`
 * decimal places is refused, never rounded. Trailing zeros past the step change no value and pass.
 * Error cases:
 * - the text matched the digit pattern but did not parse; the pattern admits only what `parseFixed` takes, so this is a broken invariant
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
  // Digits and at most six places after the trailing zeros are dropped, which `parseFixed` always takes.
  if (qty === null) throw new Error(`size ${trimmed} matched the size pattern but did not parse`);
  return { kind: "qty", qty };
}

/**
 * The size a new ticket starts at: the smallest quantity on the size field's step whose USD value at the
 * mark, converted as `previewTicket`'s minimum check converts it, reaches the market's `min_order_notional`.
 * A minimum of zero starts at one step. Null while the market has no mark or no FX price to value it at.
 * Error cases: none; the value grows with the quantity, so one reaches the minimum, and the search gives up (null) only past 2^128 steps.
 */
export function startingSize(market: MarketModel): string | null {
  const mark = market.mark;
  if (mark === null || mark <= 0n) return null;
  const toUsd = usdConverter(market.view, mark);
  if (toUsd === null) return null;
  const minimum = fixedFromWire(market.view.min_order_notional);
  const reaches = (steps: bigint) => toUsd(mulFixed(steps * QTY_STEP, mark)) >= minimum;
  // The value is non-decreasing in the quantity: double to a quantity that reaches the minimum, then bisect.
  let high = 1n;
  while (!reaches(high)) {
    high *= 2n;
    if (high > 1n << 128n) return null;
  }
  let low = 0n;
  while (high - low > 1n) {
    const mid = (low + high) / 2n;
    if (reaches(mid)) high = mid;
    else low = mid;
  }
  return fixedToWire(high * QTY_STEP);
}

/** What the size field shows: what the trader typed, even a cleared field (`""`), else the starting size while they have not touched it (`typed` null). */
export function sizeShown(typed: string | null, market: MarketModel): string {
  return typed ?? startingSize(market) ?? "";
}

/** `qty` cut down to the size field's step, so the size it names can be typed. */
export function truncateToStep(qty: Fixed): Fixed {
  return qty - (qty % QTY_STEP);
}

/** A position's unrealised profit or loss in USD at `mark`; null when its FX market has no price. */
export function unrealisedPnl(view: MarketView, qty: Fixed, entry: Fixed, mark: Fixed): Fixed | null {
  const toUsd = usdConverter(view, mark);
  return toUsd === null ? null : toUsd(mulFixed(qty, mark - entry));
}

/** What one contract is: a unit of the market's base asset, or of the instrument itself when it has none. */
export function contractUnit(market: MarketModel): string {
  const [base = market.symbol, quote] = market.symbol.split("-");
  return quote === undefined ? `${base} unit` : base;
}

/**
 * Converts an amount in the market's quote currency to USD, as the engine does (`QuoteCurrency::to_usd`,
 * truncated; the engine's margin and cap figures round up, a difference of a billionth the ticket's
 * estimates ignore): through the market's FX mark, the pair's own listing (USD-JPY) at `price`
 * itself. Null when the market has no FX price to convert at; the identity for a USD market.
 */
export function usdConverter(view: MarketView, price: Fixed): ((amount: Fixed) => Fixed) | null {
  const currency = view.quote_currency;
  if (currency === undefined) return (amount) => amount;
  const fx = currency.fx_market === view.id ? price : view.fx_mark == null ? null : fixedFromWire(view.fx_mark);
  if (fx === null) return null;
  return currency.currency === "jpy" ? (amount) => divFixed(amount, fx) : (amount) => mulFixed(amount, fx);
}

/** The bound a market order is shown and signed with: the user's choice, never past the market's own, which the engine clamps to (`execution/mod.rs`). */
export function slippageBound(chosenBps: number, market: MarketModel): number {
  return Math.min(chosenBps, market.view.max_slippage_bps);
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
  const houseCap = capFor(input.houseNav, spec.house_cap_bps, spec.house_cap_floor === undefined ? 0n : fixedFromWire(spec.house_cap_floor));
  const unpriced = (problem: string): TicketPreview => ({
    qty, notional: null, markNotional: 0n, quote: null, offer: null, bid: null, spreadBps: 0, worstPrice: null, marginAfter: account?.margin ?? 0n, marginAdded: 0n,
    marginUseBps: null, marginRateBps: null, impliedLeverage: null, houseCap, problems: [problem],
  });
  if (mark === null || mark <= 0n) return unpriced("No price yet.");
  // The node refuses every fill of a market quoted in another currency while its FX market has no price.
  const toUsd = usdConverter(spec, mark);
  if (toUsd === null) return unpriced(NO_FX_PRICE);
  // Margin tiers, spread tiers and the house's cap are in USD, so every notional they read is converted.
  const usdAtMark = (units: Fixed) => toUsd(mulFixed(units, mark));
  const markNotional = usdAtMark(qty);
  const rate = slicedBps(spec.margin_tiers, 0n, markNotional);
  // The minimum is checked at the trigger price for a resting order and at the index for a fill.
  const trigger = input.resting && input.triggerPrice != null && input.triggerPrice > 0n ? input.triggerPrice : null;
  const toUsdAtBasis = trigger === null ? toUsd : usdConverter(spec, trigger);
  // A converter at a positive price is null only for want of an FX mark, which `toUsd` above already ruled out.
  if (toUsdAtBasis === null) throw new Error(`no USD conversion at the trigger price ${trigger} for market ${market.id}, though one exists at the mark`);
  const notional = toUsdAtBasis(mulFixed(qty, trigger ?? mark));
  const current = held(account, market.id);
  const quoteSide = (s: Side) =>
    quoteOrder({ index: mark, side: s, baseSpreadBps: market.baseSpreadBps, spreadTiers: spec.spread_tiers, stress: market.stress, held: current, qty, toUsd });
  const offer = quoteSide("buy");
  const bid = quoteSide("sell");
  const quote = side === "buy" ? offer : bid;
  const delta = side === "buy" ? qty : -qty;
  const grows = growthOf(current, delta).grows;
  const before = tieredMargin(spec.margin_tiers, usdAtMark(current));
  const after = tieredMargin(spec.margin_tiers, usdAtMark(current + delta));
  const marginAfter = (account?.margin ?? 0n) - before + after;
  // The rate the whole resulting position pays, the basis the required margin and the implied leverage use.
  const resulting = absFixed(usdAtMark(current + delta));
  const positionRate = resulting > 0n ? Number((after * 10_000n) / resulting) : markNotional > 0n ? rate : null;
  const equity = account?.equity ?? 0n;
  // The check the node runs: equity after the spread this fill pays, against the margin the account then needs.
  const cost = toUsd(executionCost({ held: current, entry: account?.positions.find((p) => p.market === market.id)?.entry ?? null, delta, price: quote.price, index: mark }));
  const afterCost = equity - cost;
  const useBps = afterCost > 0n ? Number((marginAfter * 10_000n) / afterCost) : equity > 0n ? 10_001 : null;
  const worst = side === "buy" ? bpsOf(quote.price, input.slippageBps) : -bpsOf(quote.price, input.slippageBps);
  if (!market.open && !input.resting) problems.push("This market is closed.");
  if (market.reduceOnly && grows) problems.push("This market only accepts orders that reduce a position.");
  if (input.resting && input.triggerPrice != null && input.triggerPrice <= 0n) problems.push(TRIGGER_NOT_POSITIVE);
  if (qty <= 0n) problems.push(NO_SIZE);
  else if (grows && notional < fixedFromWire(spec.min_order_notional)) problems.push(belowMinimum(spec.min_order_notional));
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
