/** What an order ticket shows before the user places the order: the quote, the margin it uses, the limits. */

import { absFixed, bpsOf, divFixed, fixedFromWire, mulFixed, SCALE, type Fixed } from "./fixed";
import type { Side } from "./engine/types";
import type { AccountModel, MarketModel } from "./models";
import { maxLeverage, notionalOf, quoteFor, tieredMargin, type Quote } from "./pricing";

/** The smallest step of a quantity: a millionth of a unit. */
const QTY_STEP: Fixed = SCALE / 1_000_000n;

/** The slippage bounds offered, in basis points. */
export const SLIPPAGE_CHOICES = [5, 10, 25, 50] as const;

export interface TicketInput {
  market: MarketModel;
  side: Side;
  /** The size the user entered, in dollars. */
  notional: Fixed;
  slippageBps: number;
  account: AccountModel | null;
  houseNav: Fixed;
}

export interface TicketPreview {
  /** Units of the market, truncated to the quantity step. */
  qty: Fixed;
  /** The price the order would fill at now; this is sent as the order's quoted price. */
  quote: Quote | null;
  /** The worst price the slippage bound allows. */
  worstPrice: Fixed | null;
  /** Margin the whole account needs after this order. */
  marginAfter: Fixed;
  /** The extra margin this order needs. */
  marginAdded: Fixed;
  /** Margin over equity after the order, in basis points; null with no equity. */
  marginUseBps: number | null;
  maxLeverage: number;
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
  const { market, side, notional, account } = input;
  const spec = market.view;
  const mark = market.mark;
  const problems: string[] = [];
  const houseCap = bpsOf(input.houseNav, spec.house_cap_bps);
  const base = { maxLeverage: maxLeverage(spec.margin_tiers), houseCap };
  if (mark === null || mark <= 0n) {
    return { qty: 0n, quote: null, worstPrice: null, marginAfter: account?.margin ?? 0n, marginAdded: 0n, marginUseBps: null, ...base, problems: ["No price yet."] };
  }
  const qty = (divFixed(notional, mark) / QTY_STEP) * QTY_STEP;
  const delta = side === "buy" ? qty : -qty;
  const current = held(account, market.id);
  const grows = absFixed(current + delta) > absFixed(current);
  const quote = quoteFor({
    index: mark, side, baseSpreadBps: market.baseSpreadBps, spreadTiers: spec.spread_tiers, stress: market.stress,
    heldNotional: mulFixed(current, mark), orderNotional: notionalOf(qty, mark), grows,
  });
  const before = tieredMargin(spec.margin_tiers, mulFixed(current, mark));
  const after = tieredMargin(spec.margin_tiers, mulFixed(current + delta, mark));
  const marginAfter = (account?.margin ?? 0n) - before + after;
  const equity = account?.equity ?? 0n;
  const useBps = equity > 0n ? Number((marginAfter * 10_000n) / equity) : null;
  const worst = side === "buy" ? bpsOf(quote.price, input.slippageBps) : -bpsOf(quote.price, input.slippageBps);
  if (!market.open) problems.push("This market is closed.");
  if (market.reduceOnly && grows) problems.push("This market only accepts orders that reduce a position.");
  if (qty <= 0n) problems.push("Enter a size.");
  else if (grows && notional < fixedFromWire(spec.min_order_notional)) problems.push(`Minimum order is ${spec.min_order_notional} USD.`);
  if (grows && useBps !== null && useBps > 10_000) problems.push("Not enough equity for the margin this needs.");
  if (grows && equity <= 0n) problems.push("Fund your account to trade.");
  if (grows && notional > houseCap) problems.push("Larger than the house will take in this market.");
  return {
    qty, quote, worstPrice: quote.price + worst, marginAfter, marginAdded: after - before, marginUseBps: useBps, ...base, problems,
  };
}

/** The notional that sizes the position to `leverage` times equity. */
export function notionalForLeverage(equity: Fixed, leverage: number): Fixed {
  return equity > 0n ? (equity * BigInt(Math.trunc(leverage * 100))) / 100n : 0n;
}

/** The leverage `notional` is on `equity`, to two places, or null with no equity. */
export function leverageOf(equity: Fixed, notional: Fixed): number | null {
  return equity > 0n ? Number((notional * 100n) / equity) / 100 : null;
}
