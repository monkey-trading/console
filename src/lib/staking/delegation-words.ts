/** What the Staking page says an unstake does to the account's delegations (monkey-trading/engine#587, owner decision 1). */

import type { Delegation } from "../engine/staking";
import { formatMonkey } from "../format";
import { unstakeTakes } from "./delegations";

/** A list as a sentence says it: `a`, `a and b`, `a, b and c`. */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/**
 * Where an unstake of `amount` comes from, in words: the undelegated stake first, then each
 * delegation it reduces and by how much, named by `labelOf`. Null for an amount the stake does not cover.
 */
export function unstakeWords(staked: bigint, delegations: readonly Delegation[], amount: bigint, labelOf: (address: string) => string): string | null {
  if (amount <= 0n || amount > staked) return null;
  const { fromUndelegated, reductions } = unstakeTakes(staked, delegations, amount);
  if (reductions.length === 0) return `This takes ${formatMonkey(amount)} from your undelegated stake, so no delegation changes.`;
  const cuts = listed(reductions.map((reduction) => `${formatMonkey(reduction.amount)} from your delegation to ${labelOf(reduction.candidate)}`));
  return fromUndelegated > 0n ? `This takes all ${formatMonkey(fromUndelegated)} of your undelegated stake, then ${cuts}.` : `This takes ${cuts}.`;
}
