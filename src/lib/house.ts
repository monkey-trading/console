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
  /** The seq of the `set_params` these values come from; null in the mock, which logs none, and from a node restored from an older snapshot. */
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
  /** True when the walk read the queue's end within the page cap; false marks a lower bound. */
  complete: boolean;
  /** False when the walked pages answered at different log seqs, so the totals mix states of a changing queue. */
  stable: boolean;
}

/**
 * Reads a `set_params` from an admin command of either log shape: `admin` at genesis, `signed_admin`
 * after it. Null for any other command, for one the engine rejected (a rejected command is
 * sequenced too, and its values never applied), and for one whose floor is present but not a
 * decimal. A floor the encoding leaves out is zero — the engine omits a zero floor from the wire,
 * and production's launch params carry none (`engine_core::params::ProtocolParams`). The engine
 * signs the log's frames, so past `action` the payload's shape is the engine's; the admin
 * command's listing fields are all optional, which the type system cannot narrow to `SetParams`
 * on `action` alone.
 */
export function setParamsOf(cmd: EngineCommand, events: readonly { type: string }[]): SetParams | null {
  if (events.some((event) => event.type === "admin_rejected")) return null;
  const payload = cmd.type === "admin" ? cmd : cmd.type === "signed_admin" ? cmd.command : undefined;
  if (payload === undefined || payload.action !== "set_params") return null;
  const entry = payload as SetParams;
  const { profit_fee_bps, closeout_level_bps, house_total_cap_bps } = entry;
  const floor = typeof entry.house_total_cap_floor === "string" ? entry.house_total_cap_floor : "0";
  if (parseFixed(floor) === null) return null;
  return { profit_fee_bps, closeout_level_bps, house_total_cap_bps, house_total_cap_floor: floor };
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
 * Sums a withdrawal queue's pages into their totals. `complete` marks a walk that read the queue's
 * end within its page cap (false marks a lower bound); `stable` is false when the pages answered at
 * different log seqs, so the totals mix states of a queue that changed while it was read.
 * Error cases:
 * - an entry's `remaining` is not a decimal: a broken invariant, the engine never sends one
 */
export function queueTotals(pages: readonly { seq: number | null; queue: readonly { remaining: string }[] }[], complete: boolean, stable: boolean): QueueTotals {
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
  return { count, remaining, seq, complete, stable };
}
