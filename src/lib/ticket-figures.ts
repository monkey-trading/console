/**
 * What the deal ticket shows for an order, from the console's state: its preview, its prices from the
 * node's quote (or the mock's own), and what it pays to close some of a position. `DealTicket` and the
 * trading dev scenario both read it here, so the scenario checks the figures the ticket shows.
 */

import { closeShape, ladderSlack, ticketClose, type CloseShape, type ClosePreview } from "./close-preview";
import type { Side, SpreadTier } from "./engine/types";
import { positionFee } from "./fee-words";
import { absFixed, type Fixed } from "./fixed";
import type { FeeNow } from "./holding-fee";
import type { HouseParams } from "./house";
import type { MarketModel, PositionModel } from "./models";
import { CALM, conversionAt, stressTermsAt, USD } from "./pricing";
import { ticketPrices, type TicketPrices } from "./quotes";
import type { ConsoleState } from "./store/state";
import { accountPricing, leverageReason, orderLimitProblem, ticketLimits, type TicketLimits } from "./tier-view";
import { weekendFloorBps } from "./volume-tier";
import { MARGIN_SHORT, previewTicket, usdConverter, type TicketPreview } from "./ticket";

/** The order the ticket holds: its side and size, its slippage bound, and for a limit or stop its trigger price. */
export interface TicketOrder {
  side: Side;
  qty: Fixed;
  slippageBps: number;
  resting: boolean;
  triggerPrice: Fixed | null;
}

export interface TicketFigures {
  preview: TicketPreview;
  prices: TicketPrices;
  /** The account's tier limits in this market: best-price size, leverage and resting orders; null from a node that predates volume tiers. */
  limits: TicketLimits | null;
  /** The market's spread bands as this account pays them: its first band ends at its tier's best-price size once the tier table is read; the listed bands before. */
  spreadTiers: readonly SpreadTier[];
  /** Whether those bands are the account's own, with a first band narrower than the listing's. */
  ownBands: boolean;
  /** Why a resting order is stopped: the account already rests its tier's limit; null for a market order or while there is room. */
  orderProblem: string | null;
  /** A market order's close of some of the position, or null for one that closes nothing or a resting order. */
  close: ClosePreview | null;
  /** How much of the position a market order closes, whatever its figures; null for one that closes nothing or a resting order. */
  closing: CloseShape | null;
  /** Why a closing order's figures are withheld; null while they are shown or the order closes nothing. */
  closeWithheld: string | null;
}

/** The house state's parameters while they are current: read since every change to them the stream carried; null otherwise. */
export function currentParams(state: ConsoleState): HouseParams | null {
  return state.pricingCurrent ? state.houseParams : null;
}

/**
 * Why the trading surfaces show no terms from the house state: its first read failed or the node serves
 * none, or a change the stream carried is unread, or its read failed since. Null while the terms are current.
 */
export function houseTermsNote(state: ConsoleState): string | null {
  const status = state.houseStateStatus;
  if (state.houseParams === null) {
    if (status === "failed") return "The node's parameters could not be read; the console reads them again by itself.";
    return status === "unavailable" ? "This node does not serve its parameters." : null;
  }
  if (state.pricingCurrent) return null;
  return status === "failed" ? "The node's parameters changed and could not be read again; the console reads them again by itself." : "Reading the node's parameters again after a change.";
}

/**
 * What closing `position` pays at the node's clock: run from its open time under the node's curve while
 * the house state held is current, else as the account read gave it (`positionFee`). Null before V55.
 */
export function positionFeeNow(state: ConsoleState, position: PositionModel): FeeNow | null {
  return positionFee(position.closeFee, currentParams(state), state.now);
}

/**
 * The ticket's figures for `order` in `market`: a whole close's price is the node's exact quote, or the
 * mock's own price, which its fill uses; any other live close is a bound at the covering ladder step,
 * moved against the trader by the engine's rounding slack (`ladderSlack`). While the house state held is
 * not current, a change to the fee may be unread, so no close preview is stated.
 */
export function ticketFigures(state: ConsoleState, market: MarketModel, order: TicketOrder): TicketFigures {
  const live = state.signatures === "checked";
  const params = currentParams(state);
  const position = state.account?.positions.find((p) => p.market === market.id) ?? null;
  // Before V55 a close pays the base, which the parameters name.
  const fee = position === null ? null : positionFeeNow(state, position);
  const feeBps = fee?.feeBps ?? params?.profitFeeBps ?? null;
  // The account's tier sets the margin floor of its initial requirement and the end of its first spread band; both come from the table the parameters name.
  const pricing = accountPricing(state.account, params, market.view);
  const limits = ticketLimits(state.account, market.id, { floorBps: pricing.marginFloorBps ?? null, weekendBps: weekendFloorBps(market.view.weekend_margin, state.now) });
  // The margin use after the order comes from the console's own prices, which do not know a live node's toxicity add-on, so it is shown only for the in-browser node.
  const shown = previewTicket({
    ...pricing,
    market, side: order.side, qty: order.qty, slippageBps: order.slippageBps, resting: order.resting, triggerPrice: order.triggerPrice, account: state.account,
    houseNav: state.house.nav, estimates: !live, stress: stressTermsAt(params?.stressLevels, market.stress), closeFeeBps: feeBps ?? undefined,
  });
  // The in-browser node's refusal for margin names the leverage the tier allows, as a live node's declined quote does.
  const preview = live ? shown : { ...shown, problems: shown.problems.map((p) => (p === MARGIN_SHORT ? `${p}${leverageReason(limits)}` : p)) };
  const prices = ticketPrices({ live, quote: state.quotes[market.id] ?? null, quoteError: state.quoteError, preview, side: order.side, mark: market.mark, limits });
  const exactPrice = live ? prices.exactClose : true;
  const stress = stressTermsAt(params?.stressLevels, market.stress) ?? CALM;
  const conversion = market.mark === null ? USD : conversionAt(market.view, market.mark) ?? USD;
  const slack = exactPrice || prices.price === null || preview.qty <= 0n ? 0n : ladderSlack(preview.qty, market.view.spread_tiers.length, stress.sizeMultiplierBps, conversion);
  const price = prices.price === null ? null : order.side === "sell" ? prices.price - slack : prices.price + slack;
  const close = order.resting || !state.pricingCurrent ? null : ticketClose({
    position, side: order.side, qty: preview.qty, price, exactPrice, feeBps,
    fallsAt: fee?.fallsAt ?? null, now: state.now, toUsdDown: market.mark === null ? null : usdConverter(market.view, market.mark, "down"),
  });
  const closing = order.resting || position === null || preview.qty <= 0n ? null : closeShape(position.qty, order.side, preview.qty);
  const closeWithheld = closing === null || close !== null ? null : houseTermsNote(state) ?? "The close figures show once the node's price and fee rate are read.";
  return { preview, prices, limits, spreadTiers: pricing.spreadTiers ?? market.view.spread_tiers, ownBands: pricing.spreadTiers !== undefined, orderProblem: orderLimitProblem(limits, order.resting), close, closing, closeWithheld };
}

/**
 * What closing the whole of `position` pays now in `market`, at `quoted`, the node's closing price or the
 * mock's own; or why it is withheld. Nothing is stated for a closed or unpriced market, as its Close button
 * is off; while the house state held is not current, none is, and `why` says so.
 */
export function positionClose(state: ConsoleState, market: MarketModel | undefined, position: PositionModel, quoted: Fixed | null): { close: ClosePreview | null; why: string | null } {
  if (market === undefined || !market.open || market.mark === null) return { close: null, why: null };
  if (!state.pricingCurrent) return { close: null, why: houseTermsNote(state) };
  const fee = positionFeeNow(state, position);
  const feeBps = fee?.feeBps ?? currentParams(state)?.profitFeeBps ?? null;
  const side = position.qty > 0n ? "sell" : "buy";
  const close = ticketClose({
    position, side, qty: absFixed(position.qty), price: quoted, exactPrice: true, feeBps, fallsAt: fee?.fallsAt ?? null, now: state.now, toUsdDown: usdConverter(market.view, market.mark, "down"),
  });
  return { close, why: null };
}
