/** The holding-time profit fee as the screens read it: a position's hold, the rate a close pays now and when it falls, and the curve. */

import type { CurvePoint } from "./engine/types";
import { formatRate } from "./format";
import { baseFrom, feeNow, type FeeNow } from "./holding-fee";
import type { CloseFeeModel } from "./models";

const pad = (n: number) => String(n).padStart(2, "0");

/** A hold in whole units, truncated: `8s`, `1m 05s`, `2h 03m`, `3d 04h`; a negative hold reads as none. */
export function formatHold(ms: number): string {
  const seconds = Math.floor(Math.max(ms, 0) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${pad(minutes % 60)}m`;
  return `${Math.floor(hours / 24)}d ${pad(hours % 24)}h`;
}

/** A curve point's hold to the millisecond: `10 s`, `15.683 s`, `1 min 0.492 s`, `15 min`. */
export function formatCurveHold(ms: number): string {
  const seconds = (s: number) => `${Math.floor(s / 1000)}${s % 1000 === 0 ? "" : `.${String(s % 1000).padStart(3, "0").replace(/0+$/, "")}`} s`;
  if (ms < 60_000) return seconds(ms);
  const minutes = Math.floor(ms / 60_000);
  const rest = ms % 60_000;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${seconds(rest)}`;
}

/** The node's fee terms a close reads: its base and curve, from the parameters in force. */
export interface FeeTerms {
  profitFeeBps: number;
  profitFeeCurve: readonly CurvePoint[];
}

/**
 * What closing a position pays at `now`: from its open time under the node's base and curve when the
 * parameters carry a curve, so the rate falls on screen as the hold runs, else as the account read gave
 * it. Null when the node serves no close fee for it (before V55).
 */
export function positionFee(closeFee: CloseFeeModel | null, terms: FeeTerms | null, now: number): FeeNow | null {
  if (closeFee === null) return null;
  if (terms === null || terms.profitFeeCurve.length === 0) {
    return { holdMs: Math.max(0, now - closeFee.openedAt), feeBps: closeFee.feeBps, fallsAt: closeFee.fallsAt, baseAt: null };
  }
  return feeNow(closeFee.openedAt, terms.profitFeeBps, terms.profitFeeCurve, now);
}

/**
 * When the rate next falls, in words: in how long while it holds flat, how long until it reaches the base
 * while it falls along the curve (a bp at a time), and nothing once it is the base.
 */
export function describeNextFall(fee: FeeNow, baseBps: number | null, now: number): string {
  if (fee.fallsAt === null) return "Base rate";
  if (fee.fallsAt - now >= 1_000) return `Falls in ${formatHold(fee.fallsAt - now)}`;
  if (fee.baseAt === null || baseBps === null) return "Falling";
  return `Falling to ${formatRate(baseBps)} in ${formatHold(fee.baseAt - now)}`;
}

/** The schedule as a sentence: the full fee's hold, the hold at which the base takes over, and the base. */
export function describeSchedule(terms: FeeTerms): string {
  const curve = terms.profitFeeCurve;
  const first = curve[0];
  if (first === undefined) return `A realised gain pays ${formatRate(terms.profitFeeBps)}, however long the position was held.`;
  const base = baseFrom(terms.profitFeeBps, curve);
  return `A realised gain pays ${formatRate(first.fee_bps)} on a close within ${formatCurveHold(first.hold_ms)} of the position's open, falling with the hold to ${formatRate(terms.profitFeeBps)} from ${formatCurveHold(base)} on.`;
}
