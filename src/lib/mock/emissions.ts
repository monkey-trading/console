/**
 * MONKEY emissions as the mock mirrors them: a fixed ten-minute budget shared by the period's
 * eligible net realised losses, finalised when the clock crosses a period boundary, as the engine
 * finalises periods (`engine_core::emissions`, `PeriodResult::weight`). The mock accrues from its
 * own start and has no halvings or cross-period emission debt; its simulated vault posts a
 * checkpoint at each period close, which the mock's entitlement proofs are taken against.
 */

import type { EngineEvent } from "../engine/types";
import { fixedToWire, type Fixed } from "../fixed";
import { MONKEY_UNIT } from "../format";
import type { MockState } from "./state";

/** How long one emission period runs: the engine's ten-minute periods. */
export const EMISSION_PERIOD_MS = 600_000;
/** The development period budget the engine's own scenario uses: 1,000 MONKEY (`emissions_scenario.rs`). */
export const EMISSION_PERIOD_BUDGET = 1_000n * MONKEY_UNIT;

/**
 * Records a fill's realised profit and loss and any bad debt written off against the open period,
 * as the engine's `record_period_result` does.
 */
export function recordEmissionResult(state: MockState, address: string, realised: Fixed, writtenOff: Fixed): void {
  if (realised === 0n && writtenOff === 0n) return;
  const { results } = state.emission;
  const key = address.toLowerCase();
  const held = results.get(key);
  results.set(key, {
    address: held?.address ?? address,
    realised: (held?.realised ?? 0n) + realised,
    writtenOff: (held?.writtenOff ?? 0n) + writtenOff,
  });
}

/** The account's weight: its net realised loss less what the house wrote off, or zero (`PeriodResult::weight`). */
function weightOf(result: { realised: Fixed; writtenOff: Fixed }): Fixed {
  const weight = -result.realised - result.writtenOff;
  return weight > 0n ? weight : 0n;
}

/**
 * Closes every period the clock has fully passed and returns the events: each account with weight
 * is allocated its share of the budget, truncated toward zero; an account with negative cash
 * forfeits its weight, and the remainder is cancelled, as the engine's `finalise_emissions` does.
 * The simulated vault posts a checkpoint with the close.
 */
export function closeEmissionPeriods(state: MockState): EngineEvent[] {
  const events: EngineEvent[] = [];
  const nowPeriod = Math.floor(state.now / EMISSION_PERIOD_MS);
  while (state.emission.period < nowPeriod) {
    const { period, results } = state.emission;
    const weights = [...results.values()]
      .map((result) => ({ address: result.address, weight: weightOf(result) }))
      .filter((entry) => entry.weight > 0n && (state.accounts.get(entry.address.toLowerCase())?.balance ?? 0n) >= 0n);
    const total = weights.reduce((sum, entry) => sum + entry.weight, 0n);
    let allocated = 0n;
    for (const { address, weight } of weights) {
      const amount = (EMISSION_PERIOD_BUDGET * weight) / total;
      if (amount === 0n) continue;
      const key = address.toLowerCase();
      state.entitledMonkey.set(key, (state.entitledMonkey.get(key) ?? 0n) + amount);
      allocated += amount;
      events.push({ type: "emission_allocated", account: address, period, weight: fixedToWire(weight), amount: amount.toString() });
    }
    events.push({ type: "emission_period_closed", period, budget: EMISSION_PERIOD_BUDGET.toString(), allocated: allocated.toString(), cancelled: (EMISSION_PERIOD_BUDGET - allocated).toString() });
    // The simulated vault posts a checkpoint with the close; proofs are served against it from here on.
    state.postedSeq = state.seq;
    state.emission = { period: period + 1, results: new Map() };
  }
  return events;
}
