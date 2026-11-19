/**
 * The deal ticket's take profit and stop loss from the console's state (from V79): the position the
 * order leaves, what closing all of it would fill at, the account's working order slots, and what each
 * level would realise. `DealTicket` and the trading dev scenario both read it here.
 */

import type { SpreadTier } from "./engine/types";
import { absFixed, fixedFromWire, mulFixed, type Fixed } from "./fixed";
import { checkTicketLevels, type LevelCheck, type LevelFields } from "./level-check";
import { NO_LEVELS } from "./levels";
import type { HouseParams } from "./house";
import type { AccountModel, MarketModel } from "./models";
import { CALM, conversionAt, priceOrder, stressTermsAt, type StressTerms } from "./pricing";
import type { ConsoleState } from "./store/state";
import { CLOSE_WAITS, currentParams, houseTermsNote, type TicketFigures, type TicketOrder } from "./ticket-figures";
import { usdConverter } from "./ticket";
import { accountPricing } from "./tier-view";
import { isPriced } from "./unpriced";

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
 * Whether the console's own closing price for a whole position of `held` is the engine's: with the market's
 * close-spread cap known (the mock), or a close that stays within the account's first spread band (`tiers`),
 * whose charge the engine's cap always covers, since a cap is at least the market's launch close charge: the
 * widest stress minimum and the top toxicity add-on plus the first band at the widest multiplier
 * (`close_spread::launch_close_charge_tenth_bps`). A live node serves no cap, so past the first band its
 * closing price may sit nearer the mark than the console's.
 */
export function closingExact(market: MarketModel, held: Fixed, tiers: readonly SpreadTier[]): boolean {
  if (market.ceilingBps !== null) return true;
  const bound = tiers[0]?.up_to;
  if (bound === undefined || bound === null) return true;
  const toUsd = market.mark === null ? null : usdConverter(market.view, market.mark);
  return toUsd !== null && market.mark !== null && toUsd(mulFixed(absFixed(held), market.mark)) <= fixedFromWire(bound);
}

/**
 * What the position editor measures a position of `held` in `market` from: the node's exact whole close,
 * `quoted`, where it quotes one; else the console's own close at the mark, as the engine measures from the
 * last mark while the market is shut, the mark taking a take profit where that close may be capped. An open
 * market with no live price has none, as the engine refuses a new or moved level there, and nor does a close
 * the console prices while the house's parameters are not current (`params` null).
 */
export function editorReference(account: AccountModel | null, params: HouseParams | null, market: MarketModel, held: Fixed, quoted: Fixed | null): { closing: Fixed | null; capped: Fixed | null } {
  if (quoted !== null) return { closing: quoted, capped: null };
  // Its own close needs the stress level's terms and the account's bands, which only current parameters give.
  if (params === null || market.mark === null || (market.open && !isPriced(market))) return { closing: null, capped: null };
  const tiers = accountPricing(account, params, market.view).spreadTiers ?? market.view.spread_tiers;
  const closing = closingAt(market, held, { tiers, stress: stressTermsAt(params.stressLevels, market.stress) ?? CALM, toxicityBps: account?.toxicity?.addOnBps ?? 0 });
  return { closing, capped: closing !== null && !closingExact(market, held, tiers) ? market.mark : null };
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
  // Its own close needs the stress level's terms and the account's bands, which only current parameters give.
  const closing = order.resting || params === null ? null : closingAt(market, left, { tiers, stress, toxicityBps: figures.prices.toxicityBps });
  const unmeasured = order.resting || params !== null ? null : `The take profit and stop loss cannot be checked at the moment. ${houseTermsNote(state) ?? CLOSE_WAITS}`;
  // Where the closing price may be capped nearer the mark, a take profit is measured from the mark, so none the engine refuses passes.
  const capped = closing !== null && !closingExact(market, left, tiers) ? market.mark : null;
  return checkTicketLevels({
    market, side: order.side, qty: order.qty, resting: order.resting, price: order.resting ? order.triggerPrice : figures.prices.price,
    held, heldLevels: position?.levels ?? NO_LEVELS, closing, capped, unmeasured, limits: figures.limits, fields,
    toUsdDown: market.mark === null ? null : usdConverter(market.view, market.mark, "down"),
  });
}
