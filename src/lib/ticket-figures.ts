/**
 * What the deal ticket shows for an order, from the console's state: its preview, its prices from the
 * node's quote (or the mock's own), and what it pays to close some of a position. `DealTicket` and the
 * trading dev scenario both read it here, so the scenario checks the figures the ticket shows.
 */

import { closeShape, ladderSlack, ticketClose, type CloseShape, type ClosePreview } from "./close-preview";
import type { Side, SpreadTier } from "./engine/types";
import { positionFee, type FeeTerms } from "./fee-words";
import { absFixed, type Fixed } from "./fixed";
import { discountedBase, type FeeNow } from "./holding-fee";
import type { HouseParams } from "./house";
import type { MarketModel, PositionModel } from "./models";
import { CALM, conversionAt, stressTermsAt, USD } from "./pricing";
import { ticketPrices, type TicketPrices } from "./quotes";
import type { ConsoleState } from "./store/state";
import { accountPricing, leverageReason, orderLimitProblem, ticketLimits, type TicketLimits } from "./tier-view";
import { weekendFloorBps } from "./volume-tier";
import { MARGIN_SHORT, previewTicket, usdConverter, type TicketPreview } from "./ticket";
import { offsetTicket, type OffsetTicket, type PreviewAnswer } from "./ticket-portfolio";

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
  /** For an order that concerns a hedge, what the server's preview of it says; null for any other order. */
  offset: OffsetTicket | null;
}

/** Why closing figures are withheld when no other reason applies: the price or the fee rate has not arrived. */
export const CLOSE_WAITS = "The closing figures will be shown once the price and the profit fee rate have loaded.";

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
    if (status === "failed") return "The trading terms could not be loaded. The app will try again automatically.";
    return status === "unavailable" ? "This server does not publish its trading terms." : null;
  }
  if (state.pricingCurrent) return null;
  return status === "failed" ? "The trading terms have changed, and the new terms could not be loaded. The app will try again automatically." : "The trading terms have changed. The new terms are loading.";
}

/**
 * What closing `position` pays at the node's clock: run from its open time under the node's curve while
 * the house state held is current, else as the account read gave it (`positionFee`). Null before V55.
 */
export function positionFeeNow(state: ConsoleState, position: PositionModel): FeeNow | null {
  return positionFee(position.closeFee, accountFeeTerms(state), state.now);
}

/**
 * The fee terms a close pays: the parameters' curve and their base less the account's tier's fee discount
 * (V68, read now; `max(base x (1 - d), C(hold))`). Null while the parameters are not current.
 */
export function accountFeeTerms(state: ConsoleState): FeeTerms | null {
  const params = currentParams(state);
  if (params === null) return null;
  return { profitFeeBps: discountedBase(params.profitFeeBps, state.account?.volume?.feeDiscountBps ?? 0), profitFeeCurve: params.profitFeeCurve };
}

/**
 * The ticket's figures for `order` in `market`: a whole close's price is the node's exact quote, or the
 * mock's own price, which its fill uses; any other live close is a bound at the covering ladder step,
 * moved against the trader by the engine's rounding slack (`ladderSlack`). While the house state held is
 * not current, a change to the fee may be unread, so no close preview is stated.
 */
export function ticketFigures(state: ConsoleState, market: MarketModel, order: TicketOrder, hedge: { answer: PreviewAnswer } | null = null): TicketFigures {
  const live = state.signatures === "checked";
  const params = currentParams(state);
  const position = state.account?.positions.find((p) => p.market === market.id) ?? null;
  // Before V55 a close pays the base, which the parameters name.
  const fee = position === null ? null : positionFeeNow(state, position);
  const feeBps = fee?.feeBps ?? accountFeeTerms(state)?.profitFeeBps ?? null;
  // The account's tier sets the margin floor of its initial requirement and the end of its first spread band; both come from the table the parameters name.
  const pricing = accountPricing(state.account, params, market.view);
  const weekendBps = weekendFloorBps(market.view.weekend_margin, state.now);
  const limits = ticketLimits(state.account, market.id, { floorBps: pricing.marginFloorBps ?? null, weekendBps });
  // The margin figures charge each band at the larger of the tier's floor and an applying weekend margin, as Max leverage does.
  const marginFloorBps = weekendBps > 0 ? Math.max(pricing.marginFloorBps ?? 0, weekendBps) : pricing.marginFloorBps;
  // The margin use after the order comes from the console's own prices, which do not know a live node's toxicity add-on, so it is shown only for the in-browser node.
  const shown = previewTicket({
    ...pricing, marginFloorBps,
    market, side: order.side, qty: order.qty, slippageBps: order.slippageBps, resting: order.resting, triggerPrice: order.triggerPrice, account: state.account,
    houseNav: state.house.nav, estimates: !live, stress: stressTermsAt(params?.stressLevels, market.stress), closeFeeBps: feeBps ?? undefined,
  });
  // The in-browser node's refusal for margin names the leverage the tier allows, as a live node's declined quote does.
  const estimated = live ? shown : { ...shown, problems: shown.problems.map((p) => (p === MARGIN_SHORT ? `${p}${leverageReason(limits)}` : p)) };
  const quoted = ticketPrices({ live, quote: state.quotes[market.id] ?? null, quoteError: state.quoteError, preview: estimated, side: order.side, mark: market.mark, limits, bothWays: hedge !== null });
  // For an order that concerns a hedge, the server's preview of this exact size replaces the ladder's margin verdict and the
  // console's own estimate, which swaps one position's margin; while it is awaited neither is stated, and after a failed read both stand.
  const offset = hedge === null ? null : offsetTicket(hedge.answer, state.account);
  const overruled = hedge !== null && hedge.answer !== "failed";
  const preview = !overruled ? estimated : { ...estimated, problems: estimated.problems.filter((p) => !p.startsWith(MARGIN_SHORT)), marginUseBps: offset?.useBps ?? estimated.marginUseBps };
  const refusal = offset?.refusal ?? null;
  const prices = !overruled || (!quoted.marginDeclined && refusal === null) ? quoted : { ...quoted, problem: refusal ?? (quoted.marginDeclined ? null : quoted.problem), problemIsSize: refusal !== null || quoted.problemIsSize };
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
  const closeWithheld = closing === null || close !== null ? null : houseTermsNote(state) ?? CLOSE_WAITS;
  return { preview, prices, limits, spreadTiers: pricing.spreadTiers ?? market.view.spread_tiers, ownBands: pricing.spreadTiers !== undefined, orderProblem: orderLimitProblem(limits, order.resting), close, closing, closeWithheld, offset };
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
  const feeBps = fee?.feeBps ?? accountFeeTerms(state)?.profitFeeBps ?? null;
  const side = position.qty > 0n ? "sell" : "buy";
  const close = ticketClose({
    position, side, qty: absFixed(position.qty), price: quoted, exactPrice: true, feeBps, fallsAt: fee?.fallsAt ?? null, now: state.now, toUsdDown: usdConverter(market.view, market.mark, "down"),
  });
  return { close, why: null };
}
