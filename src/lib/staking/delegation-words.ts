/** What the Staking page says a delegation change or an unstake would do to the account's delegations before the wallet is asked (monkey-trading/console#279; the unstake rule is monkey-trading/engine#587, owner decision 1). */

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

/** `before → after` in MONKEY. */
const change = (before: bigint, after: bigint) => `${formatMonkey(before)} → ${formatMonkey(after)}`;

/** What delegating `amount` to `label` changes: the undelegated stake and the delegation there. */
export function delegateWords(undelegated: bigint, held: bigint, amount: bigint, label: string): string {
  return `Undelegated ${change(undelegated, undelegated - amount)}. Your delegation to ${label} ${change(held, held + amount)}.`;
}

/** What moving `amount` from the delegation `from` holds to the one `to` holds changes; the undelegated stake stays. */
export function moveWords(from: { label: string; held: bigint }, to: { label: string; held: bigint }, amount: bigint, undelegated: bigint): string {
  return `Your delegation to ${from.label} ${change(from.held, from.held - amount)}, and to ${to.label} ${change(to.held, to.held + amount)}. Your undelegated stake stays ${formatMonkey(undelegated)}.`;
}

/** What taking `amount` back from the delegation to `label` changes. */
export function takeBackWords(held: bigint, undelegated: bigint, amount: bigint, label: string): string {
  return `Your delegation to ${label} ${change(held, held - amount)}. Undelegated ${change(undelegated, undelegated + amount)}.`;
}
