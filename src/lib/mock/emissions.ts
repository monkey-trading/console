/**
 * MONKEY emissions as the mock mirrors them: a fixed ten-minute budget shared by the period's
 * realised losses, finalised when the clock crosses a period boundary, as the engine finalises
 * periods (`engine_core::emissions`). The mock accrues from its own start and has no halvings or
 * emission debt.
 */

import type { EngineEvent } from "../engine/types";
import { fixedToWire, type Fixed } from "../fixed";
import { MONKEY_UNIT } from "../format";
import type { MockState } from "./state";

/** How long one emission period runs: the engine's ten-minute periods. */
export const EMISSION_PERIOD_MS = 600_000;
/** The development period budget the engine's own scenario uses: 1,000 MONKEY (`emissions_scenario.rs`). */
export const EMISSION_PERIOD_BUDGET = 1_000n * MONKEY_UNIT;

/** Records `loss`, a realised loss in USD, as eligible weight for the open period. */
export function noteEmissionLoss(state: MockState, address: string, loss: Fixed): void {
  const { losses, total } = state.emission;
  const key = address.toLowerCase();
  const held = losses.get(key);
  losses.set(key, { address: held?.address ?? address, loss: (held?.loss ?? 0n) + loss });
  state.emission.total = total + loss;
}

/**
 * Closes every period the clock has fully passed and returns the events: each account with a loss
 * is allocated its share of the budget, truncated toward zero; the remainder is cancelled, as the
 * engine's `finalise_emissions` does.
 */
export function closeEmissionPeriods(state: MockState): EngineEvent[] {
  const events: EngineEvent[] = [];
  const nowPeriod = Math.floor(state.now / EMISSION_PERIOD_MS);
  while (state.emission.period < nowPeriod) {
    const { period, losses, total } = state.emission;
    let allocated = 0n;
    for (const { address, loss } of losses.values()) {
      const amount = total > 0n ? (EMISSION_PERIOD_BUDGET * loss) / total : 0n;
      if (amount === 0n) continue;
      const key = address.toLowerCase();
      state.entitledMonkey.set(key, (state.entitledMonkey.get(key) ?? 0n) + amount);
      allocated += amount;
      events.push({ type: "emission_allocated", account: address, period, weight: fixedToWire(loss), amount: amount.toString() });
    }
    events.push({ type: "emission_period_closed", period, budget: EMISSION_PERIOD_BUDGET.toString(), allocated: allocated.toString(), cancelled: (EMISSION_PERIOD_BUDGET - allocated).toString() });
    state.emission = { period: period + 1, losses: new Map(), total: 0n };
  }
  return events;
}
