/**
 * What the console says about portfolio margin (monkey-trading/engine#913), and only where it changes a decision: an account
 * whose hedged positions earn a margin offset, and an order that would create, change or remove one.
 */

import { formatUsd, type Fixed } from "./fixed";
import type { PortfolioModel } from "./portfolio";

/** What a hedge's margin offset is, beside the figure. */
export const OFFSET_TIP = "Positions that hedge each other need less margin, because a loss on one side is expected to be partly offset by a gain on the other. The offset is the amount by which this hedge reduces your margin requirement.";

/** What a hedge's net exposure is, beside the figure. */
export const NET_EXPOSURE_TIP = "The value of the hedge's long positions less its short positions, each weighted by how far its market typically moves relative to the others.";

/** The close-out price's help for an account with a hedge, in place of the per-position text. */
export const HEDGED_CLOSEOUT_TIP = "The price at which your account would be closed out, assuming your other positions remain at their current prices. Positions that hedge each other are closed together where possible, and a close-out may first close positions in other markets.";

/** Under a limit or stop order that would reduce a hedged position. */
export const TRIGGERED_ORDER_NOTE = "Once triggered, this order is executed even if reducing your hedge raises your margin requirement, and your account may then be closed out if its equity is below the close-out level. While the market is closed or has no price, the order waits for the first available price.";

/** Under the take profit and stop loss of an order in a hedged market. */
export const TRIGGERED_LEVELS_NOTE = "A take profit or stop loss is executed when triggered even if closing this hedged position raises your margin requirement, and your account may then be closed out if its equity is below the close-out level. While the market is closed or has no price, it waits for the first available price.";

/** The heading over positions that are in no hedge, shown only while a hedge is listed above them. */
export const OTHER_POSITIONS = "Other positions";

/** A list of market symbols as a sentence names them: "BTC-USD and ETH-USD", "US500, US100 and US30". */
export function listSymbols(symbols: readonly string[]): string {
  if (symbols.length <= 1) return symbols[0] ?? "";
  return `${symbols.slice(0, -1).join(", ")} and ${symbols[symbols.length - 1]}`;
}

/** A hedge's heading, naming its positions. */
export function hedgeTitle(symbols: readonly string[]): string {
  return `Hedge: ${listSymbols(symbols)}`;
}

/** A hedge's net exposure as a figure: its size and side, or None when the sides match exactly. */
export function formatNetExposure(net: Fixed): string {
  if (net === 0n) return "None";
  return `${formatUsd(net < 0n ? -net : net)} ${net > 0n ? "long" : "short"}`;
}

/** The account summary's line for an account whose hedges earn an offset: the requirement before and after it, and the close-out level. */
export function describeOffsetSummary(perPosition: Fixed, portfolio: PortfolioModel): string {
  return `Your hedged positions reduce your margin from ${formatUsd(perPosition)} to ${formatUsd(portfolio.margin)}. Your account will be closed out if its equity falls below ${formatUsd(portfolio.maintenanceMargin)}.`;
}

/** Under a hedge whose positions cannot all be traded: Close hedge leaves them open, and the hedge earns no offset for new orders or withdrawals meanwhile. */
export function describeUntradable(untradable: readonly string[], members: number): string {
  if (untradable.length >= members) return "None of the positions in this hedge can be traded at present. Until they can, this hedge does not reduce the margin required for new orders or withdrawals.";
  const one = untradable.length === 1;
  return `${listSymbols(untradable)} cannot be traded at present, so Close hedge leaves ${one ? "it" : "them"} open. Until ${one ? "it" : "they"} can be traded again, this hedge does not reduce the margin required for new orders or withdrawals.`;
}

/** At a position's Close button when closing it alone would be rejected for margin. */
export function describeLoneClose(symbol: string): string {
  return `Closing ${symbol} on its own would raise your initial margin above your equity, so the order would be rejected. Close hedge closes all of the hedge's positions together.`;
}

/** The ticket's line for an order that concerns a hedge: the initial margin and equity it would leave, and whether reducing the hedge raises the margin. */
export function describeOrderMargin(before: Fixed, after: Fixed, equity: Fixed, reduces: boolean): string {
  if (reduces && after > before) return `This order reduces a hedge, so your initial margin would rise from ${formatUsd(before)} to ${formatUsd(after)}, with equity of ${formatUsd(equity)}.`;
  return `After this order, your initial margin would be ${formatUsd(after)} and your equity ${formatUsd(equity)}.`;
}

/** What follows a margin refusal of an order that reduces a hedge: the control that closes it whole. */
export const CLOSE_HEDGE_POINTER = "To close the whole hedge, use Close hedge in the positions panel.";
