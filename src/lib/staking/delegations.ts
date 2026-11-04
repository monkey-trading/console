/**
 * What the staking contract does to an account's delegations (monkey-trading/engine#586), mirrored so
 * the Staking page can show a change before the wallet confirms it. `Staking.sol` keeps an amount per
 * candidate; what the delegations do not hold of the stake is undelegated. An unstake takes the
 * undelegated stake first, then the rest from the delegations in proportion (`_reduceDelegations`):
 * from the last in `delegationsOf` order to the first, each gives the amount still to take times its
 * share of what is still delegated, rounded down, so the first gives exactly what remains.
 */

import type { Delegation } from "../engine/staking";

/** What the delegations hold in all. */
export function delegatedOf(delegations: readonly Delegation[]): bigint {
  return delegations.reduce((sum, delegation) => sum + delegation.amount, 0n);
}

/** The stake no delegation holds: what may be delegated now. */
export function undelegatedOf(staked: bigint, delegations: readonly Delegation[]): bigint {
  const rest = staked - delegatedOf(delegations);
  return rest > 0n ? rest : 0n;
}

/** The delegation to `candidate`, zero for none. */
export function delegationTo(delegations: readonly Delegation[], candidate: string): bigint {
  return delegations.find((delegation) => delegation.candidate === candidate)?.amount ?? 0n;
}

/** What an unstake of `amount` takes: from the undelegated stake, and from each delegation it reduces, in `delegationsOf` order. */
export interface UnstakeTakes {
  fromUndelegated: bigint;
  /** Each delegation the unstake reduces and by how much; one it leaves alone is not listed. */
  reductions: readonly Delegation[];
}

/**
 * The reductions `Staking.startUnstake(amount)` makes, as `_reduceDelegations` computes them.
 * Error cases:
 * - `amount` is not positive, or is more than `staked`
 */
export function unstakeTakes(staked: bigint, delegations: readonly Delegation[], amount: bigint): UnstakeTakes {
  if (amount <= 0n || amount > staked) throw new Error("An unstake takes a positive amount of at most the stake.");
  const undelegated = undelegatedOf(staked, delegations);
  if (amount <= undelegated) return { fromUndelegated: amount, reductions: [] };
  let delegated = delegatedOf(delegations);
  let rest = amount - undelegated;
  const taken: Delegation[] = [];
  for (let i = delegations.length - 1; i >= 0; i -= 1) {
    const delegation = delegations[i];
    if (delegation === undefined) continue;
    // `Math.mulDiv` rounds down, as bigint division does for these non-negative values.
    const take = (rest * delegation.amount) / delegated;
    delegated -= delegation.amount;
    rest -= take;
    if (take > 0n) taken.unshift({ candidate: delegation.candidate, amount: take });
  }
  return { fromUndelegated: undelegated, reductions: taken };
}

/**
 * The delegations after `change` adds to the one to its candidate (a negative amount takes away), in
 * the order the contract keeps them: a new candidate joins the end, and an emptied one leaves as an
 * OpenZeppelin `EnumerableSet` removes, the last entry taking its place.
 * Error cases:
 * - the change would leave a delegation below zero
 */
export function applyChange(delegations: readonly Delegation[], change: Delegation): Delegation[] {
  const next = [...delegations];
  const index = next.findIndex((delegation) => delegation.candidate === change.candidate);
  const amount = (index === -1 ? 0n : (next[index]?.amount ?? 0n)) + change.amount;
  if (amount < 0n) throw new Error("A delegation cannot go below zero.");
  if (index === -1) {
    if (amount > 0n) next.push({ candidate: change.candidate, amount });
  } else if (amount > 0n) {
    next[index] = { candidate: change.candidate, amount };
  } else {
    const last = next.pop();
    if (last !== undefined && index < next.length) next[index] = last;
  }
  return next;
}
