/** The House solvency page's figures: caps from the engine's own rules, parameters, and the withdrawal queue's totals. */

import type { EngineCommand, SetParams } from "./engine/types";
import { maxFixed, bpsOf, parseFixed, type Fixed } from "./fixed";

/** The solvency parameters a `set_params` command in the log sets, with the seq of the latest one read. */
export interface HouseParams {
  /** The share of a winning trade's profit the house keeps, in basis points. */
  profitFeeBps: number;
  /** Equity below this share of an account's margin requirement closes the account out, in basis points of margin. */
  closeoutLevelBps: number;
  /** The cap on the house's gross exposure across markets, in basis points of house NAV. */
  totalCapBps: number;
  /** The least the total cap may be, in USD notional. */
  totalCapFloor: Fixed;
  /** The seq of the `set_params` these values come from; null in the mock, which logs none. */
  seq: number | null;
}

/** The public FIFO withdrawal queue's size, summed from its pages. */
export interface QueueTotals {
  /** How many requests wait in the queue. */
  count: number;
  /** The sum of what the queue still owes, in dollars. */
  remaining: Fixed;
  /** The log seq the pages answered at; null before the first read. */
  seq: number | null;
  /** True when the page cap cut the walk before the queue's end, so the totals are a lower bound. */
  truncated: boolean;
}

/**
 * Reads a `set_params` from an admin command of either log shape: `admin` at genesis, `signed_admin`
 * after it. Null for any other command. The engine signs the log's frames, so past `action` the
 * payload's shape is the engine's; the admin command's listing fields are all optional, which the
 * type system cannot narrow to `SetParams` on `action` alone.
 * Error cases:
 * - the command names `set_params` but its floor is not a decimal: a broken invariant, the engine never sends one
 */
export function setParamsOf(cmd: EngineCommand): SetParams | null {
  const payload = cmd.type === "admin" ? cmd : cmd.type === "signed_admin" ? cmd.command : undefined;
  if (payload === undefined || payload.action !== "set_params") return null;
  const entry = payload as SetParams;
  const { profit_fee_bps, closeout_level_bps, house_total_cap_bps, house_total_cap_floor } = entry;
  if (parseFixed(house_total_cap_floor) === null) throw new Error("engine sent a malformed total cap floor");
  return { profit_fee_bps, closeout_level_bps, house_total_cap_bps, house_total_cap_floor };
}

/**
 * The cap on the house's gross exposure (or one market's) at house NAV `nav`: the larger of `nav`'s
 * share at `bps` basis points and the dollar `floor`, truncating toward zero — the engine's
 * `market_cap` and `total_cap` (`crates/core/src/engine/house.rs`).
 */
export function capFor(nav: Fixed, bps: number, floor: Fixed): Fixed {
  return maxFixed(bpsOf(nav, bps), floor);
}

/**
 * `part` as a share of `whole`, in basis points, truncated toward zero; null when `whole` is not
 * positive, so no utilisation can be stated.
 */
export function utilBps(part: Fixed, whole: Fixed): number | null {
  if (whole <= 0n) return null;
  return Number((part * 10_000n) / whole);
}

/**
 * Sums a withdrawal queue's pages into their totals; `truncated` marks a walk the caller's page cap
 * cut before the queue's end, so the totals are a lower bound.
 * Error cases:
 * - an entry's `remaining` is not a decimal: a broken invariant, the engine never sends one
 */
export function queueTotals(pages: readonly { seq: number | null; queue: readonly { remaining: string }[] }[], truncated: boolean): QueueTotals {
  let count = 0;
  let remaining = 0n;
  let seq: number | null = null;
  for (const page of pages) {
    seq = page.seq;
    for (const entry of page.queue) {
      const amount = parseFixed(entry.remaining);
      if (amount === null) throw new Error("engine sent a malformed queue remainder");
      count += 1;
      remaining += amount;
    }
  }
  return { count, remaining, seq, truncated };
}
