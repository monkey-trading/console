/**
 * The mock's dashboard data: a deterministic book of other traders around the demo account's real
 * positions, and the waves its history follows. Everything is a function of the node's clock, never
 * of the wall clock or a random draw, so a reload and a test see the same figures.
 */

import { absFixed, fixedFromWire, fixedToNumber, fixedToWire, mulFixed, type Fixed } from "../fixed";
import type { MarketId } from "../engine/types";
import type { MockState } from "./state";

const MINUTE_MS = 60_000;
/** The mock's first recorded command: its series have nothing earlier. */
export const MOCK_RECORD_BEGINS_MS = Date.UTC(2026, 9, 18, 15, 0, 0);

/** A number as the wire's decimal text, to `places` places (at most nine). */
export function wire(value: number, places = 3): string {
  return fixedToWire(BigInt(Math.round(value * 10 ** places)) * 10n ** BigInt(9 - places));
}

/** A hash of `(seed, k)` in [-1, 1): the same inputs always give the same value. */
export function noise(seed: number, k: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (((h ^ (h >>> 15)) >>> 0) / 2_147_483_648) - 1;
}

/** A slow wandering value in about [-1, 1] at time `ms`: a few waves and a per-minute jitter. */
export function wave(seed: number, ms: number): number {
  const t = ms / MINUTE_MS;
  const slow = Math.sin(t / 211 + seed) * 0.5 + Math.sin(t / 53 + seed * 2.1) * 0.3 + Math.sin(t / 17 + seed * 3.7) * 0.15;
  return Math.max(-1, Math.min(1, slow + noise(seed, Math.floor(t)) * 0.12));
}

/** What the other traders hold in a market, in dollars: the baseline each side oscillates around. */
const BASE: Record<MarketId, { long: number; short: number }> = {
  1: { long: 5_400_000, short: 6_300_000 },
  2: { long: 2_900_000, short: 2_600_000 },
  3: { long: 1_300_000, short: 1_450_000 },
  4: { long: 2_100_000, short: 1_800_000 },
  5: { long: 1_050_000, short: 1_220_000 },
};
const FALLBACK = { long: 400_000, short: 400_000 };
/** The average position's notional, which turns dollars into a count. */
export const AVERAGE_POSITION_USD = 4_800;

export interface Book {
  long: number;
  short: number;
  longPositions: number;
  shortPositions: number;
}

/** The demo account's real notional in a market, by side, at the mock's index. */
function realBook(state: MockState, id: MarketId): { long: Fixed; short: Fixed; longPositions: number; shortPositions: number } {
  const market = state.markets.get(id);
  let long = 0n;
  let short = 0n;
  let longPositions = 0;
  let shortPositions = 0;
  if (market === undefined) return { long, short, longPositions, shortPositions };
  for (const account of state.accounts.values()) {
    const held = account.positions.get(id);
    if (held === undefined || held.qty === 0n) continue;
    const notional = absFixed(mulFixed(held.qty, market.mid));
    if (held.qty > 0n) { long += notional; longPositions += 1; } else { short += notional; shortPositions += 1; }
  }
  return { long, short, longPositions, shortPositions };
}

/** A market's clients' book at node time `ms`: the other traders' waves plus the accounts the mock holds. */
export function bookAt(state: MockState, id: MarketId, ms: number): Book {
  const base = BASE[id] ?? FALLBACK;
  const real = realBook(state, id);
  const others = { long: base.long * (1 + 0.22 * wave(id * 7 + 1, ms)), short: base.short * (1 + 0.22 * wave(id * 7 + 2, ms)) };
  return {
    long: others.long + fixedToNumber(real.long),
    short: others.short + fixedToNumber(real.short),
    // The other traders' positions are counted from their notional alone; each held account is one position more, however large.
    longPositions: Math.max(1, Math.round(others.long / AVERAGE_POSITION_USD)) + real.longPositions,
    shortPositions: Math.max(1, Math.round(others.short / AVERAGE_POSITION_USD)) + real.shortPositions,
  };
}

/** The house's NAV at `ms`, which ends at `now` on the figure the node answers now. */
export function navAt(nowNav: Fixed, now: number, ms: number): number {
  const current = fixedToNumber(nowNav);
  const drift = (wave(11, ms) - wave(11, now)) * 0.012;
  return current * (1 + drift);
}

/** Cash at `ms`: steady, gaining a little as fees accrue. */
export function cashAt(nowCash: Fixed, now: number, ms: number): number {
  return fixedToNumber(nowCash) * (1 + ((ms - now) / (10 * 24 * 3_600_000)) * 0.01 + (wave(13, ms) - wave(13, now)) * 0.002);
}

/** The queued total at `ms`: a queue that fills and drains, ending at its real size. */
export function queueAt(nowQueue: Fixed, now: number, ms: number): number {
  const current = fixedToNumber(nowQueue);
  return Math.max(0, current + (Math.max(0, 1 + wave(14, ms)) - Math.max(0, 1 + wave(14, now))) * 90_000);
}

/** USD traded in a market in the minute starting at `ms`. */
export function volumeIn(id: MarketId, ms: number): number {
  const base = (BASE[id] ?? FALLBACK).long * 0.0042;
  return Math.max(0, base * (1 + 0.8 * wave(id * 5 + 3, ms)) * (1 + noise(id, Math.floor(ms / MINUTE_MS)) * 0.5));
}

/** The decimal text of a wire amount as a number, for sums the mock draws from. */
export const numberOf = (text: string): number => fixedToNumber(fixedFromWire(text));
