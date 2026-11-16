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

/** `describeNextFall` for the table's cell, which has room for 16 characters: "Base in 14m 00s" where the sentence names the base rate it falls to. */
export function describeNextFallShort(fee: FeeNow, baseBps: number | null, now: number): string {
  if (fee.fallsAt === null || fee.fallsAt - now >= 1_000 || fee.baseAt === null || baseBps === null) return describeNextFall(fee, baseBps, now);
  return `Base in ${formatHold(fee.baseAt - now)}`;
}

/** A rate in bps as a person says it, with no trailing zeros: `10000` is `100%`, `950` is `9.5%`. */
export function spokenRate(bps: number): string {
  const part = bps % 100;
  return `${Math.trunc(bps / 100)}${part === 0 ? "" : `.${String(part).padStart(2, "0").replace(/0+$/, "")}`}%`;
}

/** A hold as a person says it, rounded up to the whole second so a hold "or more" stays true: `15 minutes`, `11 minutes 59 seconds`. */
function spokenHold(ms: number): string {
  const total = Math.ceil(Math.max(ms, 0) / 1000);
  const units: [number, string][] = [[Math.floor(total / 3600), "hour"], [Math.floor(total / 60) % 60, "minute"], [total % 60, "second"]];
  return units.filter(([n]) => n > 0).map(([n, unit]) => `${n} ${unit}${n === 1 ? "" : "s"}`).join(" ");
}

/** The schedule as a sentence: the fee on a newly opened position, the lowest fee, and the hold from which it applies; one rate when the fee never falls. */
export function describeSchedule(terms: FeeTerms): string {
  const curve = terms.profitFeeCurve;
  const first = curve[0];
  const base = baseFrom(terms.profitFeeBps, curve);
  if (first === undefined || base === 0) return `The fee is ${spokenRate(terms.profitFeeBps)} of the profit, regardless of how long the position is held.`;
  return `The fee decays over time, starting at ${spokenRate(first.fee_bps)} on a newly opened position and falling to ${spokenRate(terms.profitFeeBps)} for positions held for ${spokenHold(base)} or more.`;
}
