/**
 * An offset group's loading-weighted exposure and the credit its matched part takes off the per-position requirement,
 * worked exactly in bigints and rounded once, as the engine's portfolio margin does (`crates/core/src/portfolio/exposure.rs`
 * and `Engine::leg`, `grid_charge` in `requirement.rs`, monkey-trading/engine at V84). The mock node's requirement reads it.
 */

import { SCALE, type Fixed } from "./fixed";

const BPS = 10_000n;
/** A product of three `Fixed` values is at the scale cubed: this over it brings it to `Fixed`'s. */
const SCALE_SQUARED = SCALE * SCALE;

/** One held position of a group as the requirement values it. */
export interface CreditLeg {
  qty: Fixed;
  price: Fixed;
  /** β: how far the member moves with the group's factor, either sign. */
  loading: Fixed;
  /** Its per-position requirement at the basis's bands. */
  bands: Fixed;
  /** Its USD notional, not negative. */
  notional: Fixed;
  /** ρ: its own move either way, in bps of its notional. */
  residualShockBps: number;
  /** The cost of closing it, its market's close-spread ceiling in bps; 0 where none is listed. */
  ceilingBps: number;
}

/** A group's standing from its legs: the signed net and the matched exposure, the matched part's worst loss, and its credit. */
export interface GroupCredit {
  netNotional: Fixed;
  matchedNotional: Fixed;
  worstLoss: Fixed;
  /** Which way the factor's move hurts the exposure left unmatched. */
  bindingDirection: "down" | "up" | "either";
  offset: Fixed;
}

/** One side of the exposure: its sums over its legs, the exposure at `Fixed`'s scale cubed, the charge at `Fixed`'s scale times the charge scale, the residual times 10^4. */
interface Side {
  exposure: bigint;
  bands: bigint;
  charge: bigint;
  residual: bigint;
}

const abs = (value: bigint): bigint => (value < 0n ? -value : value);
const ceilDiv = (numerator: bigint, denominator: bigint): bigint => (numerator + denominator - 1n) / denominator;

/**
 * The legs summed by side, `level` the close-out level in bps: a leg's side is the sign of quantity times price times loading,
 * and its grid charge is its notional times `ρ × level + ceiling × 10^4`, over the charge scale `10^4 × level` (`Engine::grid_charge`).
 */
function sides(legs: readonly CreditLeg[], levelBps: number): { long: Side; short: Side } {
  const long: Side = { exposure: 0n, bands: 0n, charge: 0n, residual: 0n };
  const short: Side = { exposure: 0n, bands: 0n, charge: 0n, residual: 0n };
  for (const leg of legs) {
    const negative = (leg.qty < 0n) !== (leg.price < 0n) !== (leg.loading < 0n);
    const side = negative ? short : long;
    side.exposure += abs(leg.qty) * abs(leg.price) * abs(leg.loading);
    side.bands += abs(leg.bands);
    side.charge += abs(leg.notional) * (BigInt(leg.residualShockBps) * BigInt(levelBps) + BigInt(leg.ceilingBps) * BPS);
    side.residual += abs(leg.notional) * BigInt(leg.residualShockBps);
  }
  return { long, short };
}

/**
 * The group's net, matched exposure, worst loss and credit under floor share `floorShareBps` at close-out level `levelBps`:
 * the net's magnitude rounded up, the matched exposure (twice the smaller side) rounded down, the worst loss (each matched
 * part's own move, the larger side matched in the ratio of the smaller to it) rounded up, and the credit, the matched part's
 * bands less its grid charge, at most `1 - φ` of those bands and never below zero, rounded down once (`Exposure::net`,
 * `matched`, `worst_loss`, `credit`). Exposure on one side alone matches nothing and takes no credit.
 */
export function groupCredit(legs: readonly CreditLeg[], floorShareBps: number, levelBps: number): GroupCredit {
  const { long, short } = sides(legs, levelBps);
  const shortNet = short.exposure > long.exposure;
  const net = ceilDiv(abs(long.exposure - short.exposure), SCALE_SQUARED);
  const [smaller, larger] = short.exposure < long.exposure ? [short, long] : [long, short];
  const bindingDirection = net === 0n ? "either" : shortNet ? "up" : "down";
  const netNotional = shortNet ? -net : net;
  const matched = smaller.exposure;
  const whole = larger.exposure;
  if (matched === 0n) return { netNotional, matchedNotional: 0n, worstLoss: 0n, bindingDirection, offset: 0n };
  const worstLoss = ceilDiv(smaller.residual * whole + matched * larger.residual, whole * BPS);
  const chargeScale = BPS * BigInt(levelBps);
  const bands = (smaller.bands * whole + matched * larger.bands) * chargeScale;
  const charge = smaller.charge * whole + matched * larger.charge;
  const kept = BPS - BigInt(floorShareBps);
  const capped = kept * bands < BPS * (bands - charge) ? kept * bands : BPS * (bands - charge);
  const offset = bands <= charge ? 0n : capped / (whole * chargeScale * BPS);
  return { netNotional, matchedNotional: (smaller.exposure * 2n) / SCALE_SQUARED, worstLoss, bindingDirection, offset };
}
