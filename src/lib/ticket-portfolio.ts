/**
 * Portfolio margin at the deal ticket and the Close buttons (monkey-trading/engine#913, D7 and D14; #916's order preview): which
 * orders the server is asked about, and what its answer for the exact size says. Under a grid, admission can depend on an
 * order's size in both directions, so for an order that concerns a hedge the server's answer replaces the quote ladder's.
 */

import type { OrderPreviewRequest, OrderPreviewWire } from "./engine/portfolio-types";
import type { MarketId, MarketQuote, Reject, Side } from "./engine/types";
import { fixedFromWire, fixedToWire, type Fixed } from "./fixed";
import { describeReject } from "./messages";
import type { AccountModel, MarketModel } from "./models";
import { creditedGroupOf, touchesOffset } from "./portfolio";
import { CLOSE_HEDGE_POINTER, describeOrderMargin, TRIGGERED_LEVELS_NOTE, TRIGGERED_ORDER_NOTE } from "./portfolio-words";
import { requirementOf } from "./account-figures";
import type { ConsoleState } from "./store/state";

/** The server's answer for a request: its preview, `"failed"` when the read failed or the server predates the route, or undefined while awaited. */
export type PreviewAnswer = OrderPreviewWire | "failed" | undefined;

/** What the ticket shows from the server's answer for an order that concerns a hedge. */
export interface OffsetTicket {
  /** The initial margin and equity the order would leave; null while awaited, after a failed read, or when the order would be refused. */
  line: string | null;
  /** Why the order would be refused for margin at this exact size; null when it would not, or no answer has arrived. */
  refusal: string | null;
  /** The initial margin over the equity the order would leave, in bps, for the margin use; null without an answer or equity. */
  useBps: number | null;
  /** Whether the server has answered for this order, so its verdict replaces the ladder's and the console's own. */
  answered: boolean;
}

/** One preview's key: the same order for the same account asks once. */
export const previewKey = (request: OrderPreviewRequest): string => `${request.account}|${request.market}|${request.side}|${request.qty}|${request.reduceOnly}`;

/**
 * The request a `previewKey` names.
 * Error cases:
 * - a key `previewKey` did not make: a broken invariant
 */
export function requestOfKey(key: string): OrderPreviewRequest {
  const [account, market, side, qty, reduceOnly] = key.split("|");
  if (account === undefined || market === undefined || (side !== "buy" && side !== "sell") || qty === undefined || reduceOnly === undefined) throw new Error(`not a preview key: ${key}`);
  return { account, market: Number(market), side, qty, reduceOnly: reduceOnly === "true" };
}

/** Whether a refusal is for margin, which under a grid can depend on the order's size either way. */
export const isMarginRefusal = (reject: Reject | null | undefined): boolean => reject?.kind === "insufficient_margin" || reject?.kind === "weekend_margin";

/**
 * The preview the ticket asks for a market order of `qty` on `side`, or null when the order does not concern portfolio margin
 * (`touchesOffset`), is not a market order, has no size, or there is no credited account to ask about.
 */
export function previewRequest(state: ConsoleState, market: MarketModel, order: { side: Side; qty: Fixed; resting: boolean }): OrderPreviewRequest | null {
  const account = state.account;
  if (order.resting || order.qty <= 0n || state.wallet === null || account === null) return null;
  const markOf = (id: MarketId) => state.markets.find((m) => m.id === id)?.mark ?? null;
  const delta = order.side === "buy" ? order.qty : -order.qty;
  const touches = touchesOffset({ portfolio: account.portfolio, grid: state.houseParams?.portfolioGrid, positions: account.positions, markOf, market: market.id, delta });
  return touches ? { account: state.wallet.address, market: market.id, side: order.side, qty: fixedToWire(order.qty), reduceOnly: false } : null;
}

/** What the ticket shows from `answer` for an account that holds `account` now. */
export function offsetTicket(answer: PreviewAnswer, account: AccountModel | null): OffsetTicket {
  if (answer === undefined || answer === "failed" || account === null) return { line: null, refusal: null, useBps: null, answered: false };
  const equity = fixedFromWire(answer.equity);
  const initial = fixedFromWire(answer.initial_margin);
  const reduces = answer.fill?.increases === false;
  const useBps = equity > 0n ? Number((initial * 10_000n) / equity) : null;
  if (isMarginRefusal(answer.refused) && answer.refused !== null) {
    return { line: null, refusal: `${describeReject(answer.refused)}${reduces ? ` ${CLOSE_HEDGE_POINTER}` : ""}`, useBps, answered: true };
  }
  return { line: answer.refused === null ? describeOrderMargin(requirementOf(account), initial, equity, reduces) : null, refusal: null, useBps, answered: true };
}

/**
 * The note for an order on a hedged position whose fill waits for a trigger (D14): a limit or stop that would reduce the
 * position, or a take profit or stop loss named on the order. Null in a market in no hedge that earns an offset.
 */
export function triggeredNote(account: AccountModel | null, market: MarketId, order: { side: Side; resting: boolean }, levelsNamed: boolean): string | null {
  if (account === null || creditedGroupOf(account.portfolio, market) === null) return null;
  const held = account.positions.find((p) => p.market === market)?.qty ?? 0n;
  if (order.resting && held !== 0n && (order.side === "buy") === (held < 0n)) return TRIGGERED_ORDER_NOTE;
  return levelsNamed ? TRIGGERED_LEVELS_NOTE : null;
}

/** The reason the node's exact close quote gives for refusing to close the whole position on `side` (V84), when it closes exactly `qty`. */
export function closeDeclined(quote: MarketQuote | undefined, side: Side, qty: Fixed): Reject | null {
  const close = quote?.close;
  return close != null && close.side === side && fixedFromWire(close.qty) === qty ? (close.declined ?? null) : null;
}

/** The previews a simulated build asks for each hedged position's whole close, which the in-browser node answers as a live node's exact close quote would. */
export function closeRequests(state: ConsoleState): OrderPreviewRequest[] {
  const { account, wallet } = state;
  if (state.signatures === "checked" || wallet === null || account === null) return [];
  return account.positions.filter((p) => creditedGroupOf(account.portfolio, p.market) !== null).map((p) => ({
    account: wallet.address, market: p.market, side: p.qty > 0n ? "sell" : "buy", qty: fixedToWire(p.qty > 0n ? p.qty : -p.qty), reduceOnly: true,
  }));
}
