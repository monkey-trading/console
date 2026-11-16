/**
 * What an order that closes some or all of a position pays, before it is placed: the realised result
 * at its price, the profit fee on it at the rate a close pays now, and what the account keeps, as the
 * engine books a fill (`Position::apply`, `QuoteCurrency::to_usd`, `execution::profit_fee`).
 */

import type { Side } from "./engine/types";
import { absFixed, minFixed, SCALE, ZERO, type Fixed } from "./fixed";
import { mulRounded } from "./fixed-rounding";
import { profitFee } from "./holding-fee";
import type { Conversion } from "./pricing";

/** How near the rate's next fall may be for a whole close to stay exact: an order placed now reaches the node well within it. */
export const RATE_HOLD_MS = 1_000;

/**
 * How much worse than the quote ladder's step that covers it an order of `qty` units can price, in raw
 * price units. The engine rounds each band charge on the slices it opens and closes up to a raw unit of
 * USD, rounds the stress multiplier's product up, converts the size charge from USD to the quote currency
 * rounded up, and rounds its division by the size up, while the step's larger size can round less
 * (`Quoter::quote`, `ladder.rs`). So the USD roundings are counted through the multiplier and the
 * market's conversion, never as raw units of the quote currency, plus the conversion's own unit; each
 * raw unit of cost is `SCALE / qty` raw units of price.
 */
export function ladderSlack(qty: Fixed, bands: number, sizeMultiplierBps: number, conversion: Conversion): Fixed {
  const usdUnits = (BigInt(2 * bands) * BigInt(sizeMultiplierBps) + 9_999n) / 10_000n + 1n;
  const costUnits = conversion.fromUsd(usdUnits, "up") + 1n;
  return (costUnits * SCALE + qty - 1n) / qty + 1n;
}

/** How much of a position an order closes, which its price does not change. */
export interface CloseShape {
  /** The units the order closes: all of it, or the whole position for one that reverses it. */
  closed: Fixed;
  /** Whether it closes the whole position and no more. */
  whole: boolean;
  /** Whether it closes the whole position and opens the other side. */
  reverses: boolean;
}

export interface ClosePreview extends CloseShape {
  /** The price it closes at: the fill's while nothing moves when `exact`, else one the fill meets or beats. */
  price: Fixed;
  /** The realised result in USD, rounded down as the engine books it. */
  realised: Fixed;
  /** The profit fee rate a gain pays, in bps. */
  feeBps: number;
  /** The fee in USD, rounded up; nothing on a loss. */
  fee: Fixed;
  /** What the close moves the account's cash by: the realised result less the fee. */
  net: Fixed;
  /**
   * True when the figures are the fill's while nothing moves: the price is the node's quote for
   * closing the whole position and the rate holds. Otherwise they are a bound: the fill's price is no
   * worse, its fee no higher, and what it keeps no less.
   */
  exact: boolean;
}

export interface CloseOrder {
  /** The signed quantity held, and its entry price. */
  held: Fixed;
  entry: Fixed;
  side: Side;
  qty: Fixed;
  /** The price the order fills at: the node's whole-close quote, its ladder step moved against the trader by `ladderSlack`, or the mock's own price. */
  price: Fixed;
  /** Whether `price` is exact for this order: the whole-close quote for a whole close, or the mock's own price, which its fill uses. */
  exactPrice: boolean;
  feeBps: number;
  /** When the rate next falls, null once it is the base, and the node's time now. */
  fallsAt: number | null;
  now: number;
  /** Converts a result in the market's quote currency to USD, rounded down; the identity for a USD market. */
  toUsdDown: (amount: Fixed) => Fixed;
}

/** What an order of `qty` on `side` closes of the position `held`, or null for one that closes nothing: no position, or one on the order's own side. */
export function closeShape(held: Fixed, side: Side, qty: Fixed): CloseShape | null {
  if (held === ZERO || (side === "buy") === (held > ZERO)) return null;
  return { closed: minFixed(qty, absFixed(held)), whole: qty === absFixed(held), reverses: qty > absFixed(held) };
}

/** The realised result in USD of closing `closed` units of `held` (entry `entry`) at `price`, rounded down as the engine books it: `(price - entry) * sign(held)` over the units, then to USD. */
export function realisedAt(held: Fixed, entry: Fixed, closed: Fixed, price: Fixed, toUsdDown: (amount: Fixed) => Fixed): Fixed {
  const move = held > ZERO ? price - entry : entry - price;
  return toUsdDown(mulRounded(move, closed, "down"));
}

/** The preview of an order's close, or null for an order that closes nothing: no position, or one on the order's own side. */
export function previewClose(order: CloseOrder): ClosePreview | null {
  const { held } = order;
  const shape = closeShape(held, order.side, order.qty);
  if (shape === null) return null;
  const { closed } = shape;
  const realised = realisedAt(held, order.entry, closed, order.price, order.toUsdDown);
  const fee = profitFee(realised, order.feeBps);
  const rateHolds = order.fallsAt === null || order.fallsAt - order.now >= RATE_HOLD_MS;
  return { ...shape, price: order.price, realised, feeBps: order.feeBps, fee, net: realised - fee, exact: order.exactPrice && rateHolds };
}

/** What the deal ticket knows of an order that may close a position. */
export interface TicketClose {
  /** The signed quantity and entry held in the market, or null with no position. */
  position: { qty: Fixed; entry: Fixed } | null;
  side: Side;
  qty: Fixed;
  /** The price a market order is sent at; null when there is none. */
  price: Fixed | null;
  exactPrice: boolean;
  /** The rate a close pays now and when it next falls, or null when the node gives none. */
  feeBps: number | null;
  fallsAt: number | null;
  now: number;
  /** The market's conversion to USD rounded down, or null for want of an FX price. */
  toUsdDown: ((amount: Fixed) => Fixed) | null;
}

/** The ticket's preview of an order's close, or null when it closes nothing or a figure it needs is missing. */
export function ticketClose(input: TicketClose): ClosePreview | null {
  const { position, price, feeBps, toUsdDown } = input;
  if (position === null || price === null || feeBps === null || toUsdDown === null || input.qty <= ZERO) return null;
  return previewClose({ held: position.qty, entry: position.entry, side: input.side, qty: input.qty, price, exactPrice: input.exactPrice, feeBps, fallsAt: input.fallsAt, now: input.now, toUsdDown });
}
