/**
 * Portfolio margin as the console reads it (monkey-trading/engine#913): the account read's portfolio requirement and offset
 * groups (V81), and which of them earn a credit. Detail is shown only for a group whose positions offset each other and earn
 * one, so an account that earns none sees the console as it would without portfolio margin.
 */

import type { MarketId } from "./engine/types";
import type { PortfolioMarginWire } from "./engine/portfolio-types";
import { parseFixed, type Fixed } from "./fixed";

/** One offset group the account holds a member of, at the market's bands. */
export interface OffsetGroupModel {
  /** The grid's name for the group, which keys it; never shown. */
  name: string;
  /** The group's markets the account holds, in the grid's order. */
  members: MarketId[];
  /** The loading-weighted net notional, in USD: positive long, negative short. */
  netNotional: Fixed;
  /** The exposure that offsets other exposure in the group, in USD. */
  matchedNotional: Fixed;
  /** What the group takes off the per-position requirement, in USD. */
  offset: Fixed;
}

/** The account's portfolio requirement: at the market's bands, at initial bands (what new risk and withdrawals meet) and at the close-out level. */
export interface PortfolioModel {
  margin: Fixed;
  initialMargin: Fixed;
  maintenanceMargin: Fixed;
  groups: OffsetGroupModel[];
}

/** The read's `portfolio_margin`, or undefined when absent (no grid, or a node that predates V81) or malformed. */
export function decodePortfolio(wire: PortfolioMarginWire | undefined): PortfolioModel | undefined {
  if (wire === undefined) return undefined;
  const [margin, initialMargin, maintenanceMargin] = [wire.margin, wire.initial_margin, wire.maintenance_margin].map(parseFixed);
  if (margin == null || initialMargin == null || maintenanceMargin == null) return undefined;
  const groups: OffsetGroupModel[] = [];
  for (const [name, group] of Object.entries(wire.groups)) {
    const [netNotional, matchedNotional, offset] = [group.net_notional, group.matched_notional, group.offset].map(parseFixed);
    if (netNotional == null || matchedNotional == null || offset == null || !group.members.every(Number.isSafeInteger)) return undefined;
    groups.push({ name, members: [...group.members], netNotional, matchedNotional, offset });
  }
  return { margin, initialMargin, maintenanceMargin, groups };
}

/** The groups whose positions offset each other and earn a credit, the only ones the console shows. */
export function creditedGroups(portfolio: PortfolioModel | undefined): OffsetGroupModel[] {
  return portfolio?.groups.filter((group) => group.offset > 0n && group.members.length > 1) ?? [];
}

/** The sum of every group's credit, which the account's requirement is below its per-position margin by. */
export function totalOffset(portfolio: PortfolioModel | undefined): Fixed {
  return creditedGroups(portfolio).reduce((sum, group) => sum + group.offset, 0n);
}
