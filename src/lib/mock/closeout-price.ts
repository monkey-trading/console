/** Where each position's market must reach for the account to be closed out: the rule of the node's account read (monkey-trading/engine#474, `stats/closeout.rs`), on the mock's dollar markets. */

import { absFixed, bpsOf, divFixed, fixedFromWire, fixedToWire, mulFixed, type Fixed, ZERO } from "../fixed";
import type { PositionCloseout } from "../engine/account-types";
import { CLOSE_OUT_BPS, tieredMargin } from "../pricing";
import { equityOf, marginOf } from "./accounts";
import type { AccountState, MockState } from "./state";

/** How far a short may rise before its close-out counts as none, as a multiple of its mark: the node's own range for a short (a long's is down to zero). */
const SHORT_RANGE = 10n;

/**
 * Each position's close-out, with the account's other positions held at their marks. The slack, the
 * account's equity less the close-out share of its margin, moves linearly with the price inside a
 * margin band, so the walk from the mark meets the bands' bounds in order and interpolates where
 * the slack turns negative.
 */
export function closeoutsOf(state: MockState, account: AccountState): PositionCloseout[] {
  const equity = equityOf(state, account);
  const margin = marginOf(state, account);
  const result: PositionCloseout[] = [];
  for (const [id, held] of account.positions) {
    const market = state.markets.get(id);
    if (!market) continue;
    const tiers = market.listed.spec.margin_tiers;
    const mark = market.mid;
    const long = held.qty > ZERO;
    const size = absFixed(held.qty);
    const others = margin - tieredMargin(tiers, mulFixed(size, mark));
    const slack = (price: Fixed): Fixed => equity + mulFixed(held.qty, price - mark) - bpsOf(others + tieredMargin(tiers, mulFixed(size, price)), CLOSE_OUT_BPS);
    if (slack(mark) < ZERO) {
      result.push({ market: id, reach: "due", price: null });
      continue;
    }
    const edge = long ? ZERO : mark * SHORT_RANGE;
    const bounds = tiers
      .flatMap((tier) => (tier.up_to === null ? [] : [divFixed(fixedFromWire(tier.up_to), size)]))
      .filter((bound) => bound > (long ? edge : mark) && bound < (long ? mark : edge))
      .sort((a, b) => (long ? (a < b ? 1 : -1) : a < b ? -1 : 1));
    let near = { price: mark, slack: slack(mark) };
    let found: Fixed | null = null;
    for (const price of [...bounds, edge]) {
      const here = slack(price);
      if (here < ZERO) {
        found = near.price + ((price - near.price) * near.slack) / (near.slack - here);
        break;
      }
      near = { price, slack: here };
    }
    result.push(found !== null && found > ZERO ? { market: id, reach: "at", price: fixedToWire(found) } : { market: id, reach: "beyond", price: null });
  }
  return result;
}
