/** Advances the mock node's clock: moves the indices, opens and closes markets, and settles. */

import { absFixed, bpsOf, fixedFromInt, fixedToWire, moveBps, mulFixed, type Fixed } from "../fixed";
import type { EngineEvent, SourceQuote } from "../engine/types";
import { closeOutUnderwater } from "./closeout";
import { closeEmissionPeriods } from "./emissions";
import { closeDistributionEpochs } from "./monkey";
import { creditFinal, payQueue } from "./funds";
import { triggerResting } from "./orders";
import { MAX_STRESS } from "../pricing";
import { isOpen } from "../schedule";
import type { MarketRuntime, MockState } from "./state";

/** The stress window, in milliseconds. */
const STRESS_WINDOW_MS = 60_000;
/** Largest simulated step, so a backgrounded tab does not jump the indices. */
const MAX_STEP_MS = 5_000;
/** How often the vault receives liquidity, and how much. */
const LIQUIDITY_EVERY_MS = 10_000;
const LIQUIDITY_STEP = fixedFromInt(25_000);
/** Overnight financing, charged to every open position at 22:00 UTC, in basis points of its notional. */
const FINANCING_BPS = 2;
const ROLLOVER_MS = 22 * 3_600_000;
const DAY_MS = 86_400_000;
const VENUES = ["venue-a", "venue-b", "venue-c"] as const;

/** A draw from roughly N(0, 1): the sum of four uniforms, centred and scaled. */
function gaussian(rand: () => number): number {
  return (rand() + rand() + rand() + rand() - 2) * Math.sqrt(3);
}

/** The automatic stress level: how far the index moved over the window, against the market's volatility. */
function stressFor(market: MarketRuntime, now: number): number {
  const keep = market.window.filter((sample) => now - sample.t <= STRESS_WINDOW_MS);
  market.window = keep;
  const first = keep[0];
  const move = first ? Math.abs(moveBps(first.mid, market.mid)) : 0;
  const unit = market.listed.sim.volBps;
  const level = move >= unit * 70 ? 3 : move >= unit * 35 ? 2 : move >= unit * 15 ? 1 : 0;
  return Math.min(MAX_STRESS, Math.max(level, market.floor));
}

/** Moves one market for `seconds` and returns the events its open, close, and stress produce. */
function stepMarket(state: MockState, market: MarketRuntime, seconds: number): EngineEvent[] {
  const events: EngineEvent[] = [];
  const id = market.listed.spec.id;
  const open = isOpen(market.listed.spec.schedule, state.now) && !market.halted;
  if (open !== market.open) {
    market.open = open;
    events.push({ type: open ? "market_opened" : "market_closed", market: id });
  }
  if (market.open) {
    const drift = gaussian(market.rand) * market.listed.sim.volBps * Math.sqrt(seconds) + market.shockBps;
    market.mid += (market.mid * BigInt(Math.round(drift * 100))) / 1_000_000n;
    market.shockBps = 0;
    market.window.push({ t: state.now, mid: market.mid });
  }
  const level = stressFor(market, state.now);
  if (level !== market.stress) {
    market.stress = level;
    events.push({ type: "stress_changed", market: id, level });
  }
  return events;
}

/** Three venue quotes around the index, as the node's feeds report them. */
function venueQuotes(state: MockState, mid: Fixed): SourceQuote[] {
  return VENUES.map((source, i) => ({ source, mid: fixedToWire(mid + ((mid * BigInt(i - 1)) / 100_000n)), ts: state.now }));
}

/** Charges the day's financing to each position when the clock crosses 22:00 UTC. */
function chargeFinancing(state: MockState, previous: number): EngineEvent[] {
  const day = (ms: number) => Math.floor((ms - ROLLOVER_MS) / DAY_MS);
  if (day(state.now) <= day(previous)) return [];
  const events: EngineEvent[] = [];
  for (const [address, account] of state.accounts) {
    for (const [id, held] of account.positions) {
      const market = state.markets.get(id);
      if (!market) continue;
      // As in the engine, the amount is what the account pays: positive is a charge.
      const charge = bpsOf(absFixed(mulFixed(held.qty, market.mid)), FINANCING_BPS);
      account.balance -= charge;
      state.houseCash += charge;
      events.push({ type: "financing", account: address, market: id, amount: fixedToWire(charge) });
    }
  }
  return events;
}

/**
 * Advances the node to `ms`: each market moves and publishes a `prices` command; then one `tick`
 * command carries the resulting events (market hours, stress, triggered orders, close-outs,
 * credited deposits, and queue payments).
 */
export function advance(state: MockState, ms: number, options: { liquidity?: boolean } = {}): void {
  if (ms <= state.now) return; // the clock never runs backwards
  const seconds = Math.min(ms - state.now, MAX_STEP_MS) / 1000;
  const previous = state.now;
  state.now = ms;
  const events: EngineEvent[] = [];
  for (const market of state.markets.values()) {
    events.push(...stepMarket(state, market, seconds));
    if (market.open && !state.quietPrices) state.emit({ type: "prices", market: market.listed.spec.id, quotes: venueQuotes(state, market.mid) }, []);
  }
  // Emission periods finalise before the command's other effects, as the engine's apply does, so a
  // charge this tick lands cannot forfeit a weight the account held at the period's cutoff.
  events.push(...closeEmissionPeriods(state));
  closeDistributionEpochs(state);
  events.push(...chargeFinancing(state, previous), ...triggerResting(state), ...closeOutUnderwater(state), ...creditFinal(state));
  const bucket = (t: number) => Math.floor(t / LIQUIDITY_EVERY_MS);
  events.push(...payQueue(state, options.liquidity !== false && bucket(ms) > bucket(previous) ? LIQUIDITY_STEP : 0n));
  state.emit({ type: "tick" }, events);
}
