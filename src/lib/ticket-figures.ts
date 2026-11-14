/**
 * What the deal ticket shows for an order, from the console's state: its preview, its prices from the
 * node's quote (or the mock's own), and what it pays to close some of a position. `DealTicket` and the
 * trading dev scenario both read it here, so the scenario checks the figures the ticket shows.
 */

import { ladderSlack, ticketClose, type ClosePreview } from "./close-preview";
import type { Side } from "./engine/types";
import { positionFee } from "./fee-words";
import type { Fixed } from "./fixed";
import type { FeeNow } from "./holding-fee";
import type { HouseParams } from "./house";
import type { MarketModel, PositionModel } from "./models";
import { stressTermsAt } from "./pricing";
import { ticketPrices, type TicketPrices } from "./quotes";
import type { ConsoleState } from "./store/state";
import { previewTicket, usdConverter, type TicketPreview } from "./ticket";

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
  /** A market order's close of some of the position, or null for one that closes nothing or a resting order. */
  close: ClosePreview | null;
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
  // The margin use after the order comes from the console's own prices, which do not know a live node's toxicity add-on, so it is shown only for the in-browser node.
  const preview = previewTicket({
    market, side: order.side, qty: order.qty, slippageBps: order.slippageBps, resting: order.resting, triggerPrice: order.triggerPrice, account: state.account,
    houseNav: state.house.nav, estimates: !live, stress: stressTermsAt(params?.stressLevels, market.stress), closeFeeBps: feeBps ?? undefined,
  });
  const prices = ticketPrices({ live, quote: state.quotes[market.id] ?? null, quoteError: state.quoteError, preview, side: order.side, mark: market.mark });
  const exactPrice = live ? prices.exactClose : true;
  const slack = exactPrice || prices.price === null || preview.qty <= 0n ? 0n : ladderSlack(preview.qty, market.view.spread_tiers.length);
  const price = prices.price === null ? null : order.side === "sell" ? prices.price - slack : prices.price + slack;
  const close = order.resting || !state.pricingCurrent ? null : ticketClose({
    position, side: order.side, qty: preview.qty, price, exactPrice, feeBps,
    fallsAt: fee?.fallsAt ?? null, now: state.now, toUsdDown: market.mark === null ? null : usdConverter(market.view, market.mark, "down"),
  });
  return { preview, prices, close };
}
