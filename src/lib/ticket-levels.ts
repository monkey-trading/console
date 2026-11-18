/**
 * The deal ticket's take profit and stop loss from the console's state (from V79): the position the
 * order leaves, what closing all of it would fill at, the account's working order slots, and what each
 * level would realise. `DealTicket` and the trading dev scenario both read it here.
 */

import type { SpreadTier } from "./engine/types";
import { absFixed, type Fixed } from "./fixed";
import { checkTicketLevels, type LevelCheck, type LevelFields } from "./level-check";
import { NO_LEVELS } from "./levels";
import type { MarketModel } from "./models";
import { CALM, conversionAt, priceOrder, stressTermsAt, type StressTerms } from "./pricing";
import type { ConsoleState } from "./store/state";
import { currentParams, type TicketFigures, type TicketOrder } from "./ticket-figures";
import { usdConverter } from "./ticket";
import { accountPricing } from "./tier-view";

/**
 * What a reduce-only close of a whole position of `held` in `market` fills at, at the market's mark, as
 * the engine's `closing_price_at` prices it: the account's bands, the stress level's terms and its
 * toxicity add-on, and the mock's close-spread ceiling, which a live node does not serve. Null with no
 * position, no mark or no exchange rate.
 */
export function closingAt(market: MarketModel, held: Fixed, terms: { tiers: readonly SpreadTier[]; stress: StressTerms; toxicityBps: number }): Fixed | null {
  if (market.mark === null || held === 0n) return null;
  const conversion = conversionAt(market.view, market.mark);
  if (conversion === null) return null;
  const priced = priceOrder({ mid: market.mark, side: held > 0n ? "sell" : "buy", held, qty: absFixed(held), ...terms, ceilingBps: market.ceilingBps, conversion });
  return priced.kind === "priced" ? priced.price : null;
}

/**
 * The ticket's levels for `order`, typed in `fields`; null for a market that takes none. A market order's
 * are measured from the closing price of the position it would leave, at the mark, which the engine
 * measures at its fill; a working order's from its own price. The estimate's entry is the price the
 * order is sent at, or its trigger price.
 */
export function ticketLevels(state: ConsoleState, market: MarketModel, order: TicketOrder, fields: LevelFields, figures: Pick<TicketFigures, "prices" | "limits">): LevelCheck | null {
  const position = state.account?.positions.find((p) => p.market === market.id) ?? null;
  const held = position?.qty ?? 0n;
  const left = held + (order.side === "buy" ? order.qty : -order.qty);
  const params = currentParams(state);
  const tiers = accountPricing(state.account, params, market.view).spreadTiers ?? market.view.spread_tiers;
  const stress = stressTermsAt(params?.stressLevels, market.stress) ?? CALM;
  const closing = order.resting ? null : closingAt(market, left, { tiers, stress, toxicityBps: figures.prices.toxicityBps });
  return checkTicketLevels({
    market, side: order.side, qty: order.qty, resting: order.resting, price: order.resting ? order.triggerPrice : figures.prices.price,
    held, heldLevels: position?.levels ?? NO_LEVELS, closing, limits: figures.limits, fields,
    toUsdDown: market.mark === null ? null : usdConverter(market.view, market.mark, "down"),
  });
}
