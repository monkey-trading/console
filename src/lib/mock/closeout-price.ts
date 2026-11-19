/**
 * Where each position's market must reach for the account to be closed out: the rule of the node's account read
 * (monkey-trading/engine#474, `stats/closeout.rs`), on the mock's dollar markets, and from V81 its portfolio requirement's.
 */

import { absFixed, bpsOf, divFixed, fixedFromWire, fixedToWire, mulFixed, type Fixed, ZERO } from "../fixed";
import type { PositionCloseout } from "../engine/account-types";
import type { MarketId } from "../engine/types";
import { divRounded, mulRounded } from "../fixed-rounding";
import { CLOSE_OUT_BPS, tieredMargin } from "../pricing";
import { closeoutRequirementOf, equityOf, marginOf } from "./accounts";
import { closeoutShare, groupIndexOf, heldOnBothSides, requirementOf } from "./portfolio";
import type { AccountState, Holding, MockState } from "./state";

/** How far a short may rise before its close-out counts as none, as a multiple of its mark: the node's own range for a short (a long's is down to zero). */
const SHORT_RANGE = 10n;
/** The evenly spaced prices, the range's edge the last, at which a grouped position's search looks for the first one past a crossing (`GROUPED_SAMPLES`). */
const GROUPED_SAMPLES = 16n;

/** A price and the account's close-out slack there. */
interface Point {
  price: Fixed;
  slack: Fixed;
}

/**
 * Each position's close-out, with the account's other positions held at their marks, against the requirement its close-outs
 * read. A position in an offset group the account holds on both sides follows the group's credit, which moves with its price
 * (`groupedReach`), unless the walk at the per-position requirement, a floor under the group's, finds no price in the range.
 */
export function closeoutsOf(state: MockState, account: AccountState): PositionCloseout[] {
  const equity = equityOf(state, account);
  const requirement = closeoutRequirementOf(state, account);
  const perPosition = marginOf(state, account);
  const result: PositionCloseout[] = [];
  for (const [id, held] of account.positions) {
    const market = state.markets.get(id);
    if (!market) continue;
    const grouped = groupIndexOf(state, id) !== null;
    const floor = grouped ? walk(market.listed.spec.margin_tiers, market.mid, held, equity, perPosition) : null;
    const found = floor?.reach === "beyond" ? floor : grouped && heldOnBothSides(state, account, id) ? groupedReach(state, account, id, held, market.mid) : walk(market.listed.spec.margin_tiers, market.mid, held, equity, requirement);
    result.push({ market: id, ...found });
  }
  return result;
}

/**
 * A position's close-out by the band walk: the slack, the account's equity less the close-out share of `margin`, moves linearly
 * with the price inside a margin band, so the walk from the mark meets the bands' bounds in order and interpolates where the
 * slack turns negative.
 */
function walk(tiers: Parameters<typeof tieredMargin>[0], mark: Fixed, held: Holding, equity: Fixed, margin: Fixed): Omit<PositionCloseout, "market"> {
  const long = held.qty > ZERO;
  const size = absFixed(held.qty);
  const others = margin - tieredMargin(tiers, mulFixed(size, mark));
  const slack = (price: Fixed): Fixed => equity + mulFixed(held.qty, price - mark) - bpsOf(others + tieredMargin(tiers, mulFixed(size, price)), CLOSE_OUT_BPS);
  if (slack(mark) < ZERO) return { reach: "due", price: null };
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
  return found !== null && found > ZERO ? { reach: "at", price: fixedToWire(found) } : { reach: "beyond", price: null };
}

/**
 * A grouped position's close-out (`reach_grouped`): its slack need not move one way with its price, so the first price below the
 * level is looked for at 16 evenly spaced prices from the mark to the range's edge, then bracketed by false position (Illinois)
 * to a hundred-millionth of the mark; a dip below the level narrower than the samples' spacing is not seen.
 */
function groupedReach(state: MockState, account: AccountState, market: MarketId, held: Holding, mark: Fixed): Omit<PositionCloseout, "market"> {
  const slackAt = (price: Fixed): Fixed => {
    const { equity, requirement } = requirementOf(state, account, { kind: "market" }, [], (id) => (id === market ? price : (state.markets.get(id)?.mid ?? ZERO)));
    return equity - closeoutShare(state, requirement);
  };
  const long = held.qty > ZERO;
  const atMark = slackAt(mark);
  if (atMark < ZERO) return { reach: "due", price: null };
  const span = long ? -mark : mark * (SHORT_RANGE - 1n);
  let above: Point = { price: mark, slack: atMark };
  let below: Point | null = null;
  for (let step = 1n; step <= GROUPED_SAMPLES && below === null; step += 1n) {
    const price = mark + (span * step) / GROUPED_SAMPLES;
    const slack = slackAt(price);
    if (slack < ZERO) below = { price, slack };
    else above = { price, slack };
  }
  if (below === null) return { reach: "beyond", price: null };
  const precision = mark / 100_000_000n > 1n ? mark / 100_000_000n : 1n;
  let lastAbove: boolean | null = null;
  while (absFixed(above.price - below.price) > precision) {
    const step: Fixed = ((below.price - above.price) * above.slack) / (above.slack - below.slack);
    const tried: Fixed = above.price + step;
    const price: Fixed = tried === above.price || tried === below.price ? (above.price + below.price) / 2n : tried;
    const slack = slackAt(price);
    const nowAbove = slack >= ZERO;
    if (nowAbove) {
      above = { price, slack };
      // Halved, a slack below zero stays below it, so the next step's denominator is never zero.
      if (lastAbove === true) below = { price: below.price, slack: below.slack / 2n < -1n ? below.slack / 2n : -1n };
    } else {
      below = { price, slack };
      if (lastAbove === false) above = { price: above.price, slack: above.slack / 2n };
    }
    lastAbove = nowAbove;
  }
  // As the read rounds it: the crossing over the mark rounded up, then the mark times it, up for a long and down for a short.
  const price = mulRounded(mark, divRounded(below.price, mark, "up"), long ? "up" : "down");
  return price > ZERO ? { reach: "at", price: fixedToWire(price) } : { reach: "beyond", price: null };
}
