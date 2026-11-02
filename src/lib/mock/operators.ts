/**
 * The simulated operator registry and what the node mirrors of it: four candidates, the operator in
 * effect, and an election waiting out its notice, as `OperatorRegistry.sol` and `GET /v1/operator`
 * hold them. A delegation moves the account's stake between the candidates' votes, as `Staking`
 * does, and the election takes effect when the mock's clock reaches its time.
 */

import type { CandidateTable, DeploymentReads, NamedOperator, PendingElection } from "../engine/registry";
import { NO_CANDIDATE } from "../engine/registry";
import type { OperatorRoute } from "../engine/stats-types";
import { MONKEY_UNIT } from "../format";
import type { MockState } from "./state";

const DAY_MS = 86_400_000;
/** The share of total stake a candidate needs to be eligible, in basis points; a development value, as the registry's parameters are decided apart. */
const ELIGIBILITY_BPS = 500n;
/** The stake other delegators give each candidate, in whole MONKEY, so the visitor's own moves the figures without deciding them. */
const CANDIDATES = [
  { name: "alpha", votes: 620_000n },
  { name: "bravo", votes: 780_000n },
  { name: "charlie", votes: 240_000n },
  { name: "delta", votes: 30_000n },
] as const;

/** A stand-in address from a stand-in name; these sit where a chain would answer. */
const addressOf = (name: string, role: string): string => `0x${Array.from(`${name}.${role}`, (c) => c.charCodeAt(0).toString(16)).join("").padEnd(40, "0").slice(0, 40)}`;
const hostnameOf = (name: string): string => `${name}.operators.example`;

/** A candidate the simulated registry lists. */
interface MockCandidate {
  address: string;
  adminKey: string;
  hostname: string;
  /** MONKEY base units other delegators give it. */
  votes: bigint;
}

export class MockOperators {
  /** The candidate each account's whole stake votes for. */
  readonly delegates = new Map<string, string>();
  readonly candidates: readonly MockCandidate[] = CANDIDATES.map(({ name, votes }) => ({ address: addressOf(name, "candidate"), adminKey: addressOf(name, "admin"), hostname: hostnameOf(name), votes: votes * MONKEY_UNIT }));
  private sinceMs: number;
  private inEffect: MockCandidate;
  private next: { candidate: MockCandidate; epoch: number; effectiveAtMs: number } | null;

  constructor(startMs: number) {
    const [incumbent, challenger] = this.candidates;
    if (incumbent === undefined || challenger === undefined) throw new Error("The mock's candidate list lost its first two entries.");
    this.inEffect = incumbent;
    this.sinceMs = startMs - 45 * DAY_MS;
    this.next = { candidate: challenger, epoch: 41, effectiveAtMs: startMs + 6 * DAY_MS };
  }

  /** The operator in effect at `now`, the election once its time has come. */
  private settle(now: number): void {
    if (this.next === null || now < this.next.effectiveAtMs) return;
    this.sinceMs = this.next.effectiveAtMs;
    this.inEffect = this.next.candidate;
    this.next = null;
  }

  named(now: number): NamedOperator {
    this.settle(now);
    const pending: PendingElection | null = this.next === null ? null : { epoch: this.next.epoch, candidate: this.next.candidate.address, adminKey: this.next.candidate.adminKey, effectiveAtMs: this.next.effectiveAtMs, promoted: false };
    return { rotationEnabled: true, candidate: this.inEffect.address, adminKey: this.inEffect.adminKey, sinceMs: this.sinceMs, hostname: this.inEffect.hostname, pending };
  }

  adminKey(now: number): string {
    this.settle(now);
    return this.inEffect.adminKey;
  }
}

/** The simulated contracts' reads, as a wallet makes them; the mock vouches for itself, so its vault names nothing a check depends on. */
export function mockChainReads(state: MockState): DeploymentReads {
  return {
    vault: async () => ({ release: `0x${"0".repeat(64)}`, signer: NO_CANDIDATE }),
    operator: async () => state.operators.named(state.now),
    candidates: async () => candidateTable(state),
    delegateOf: async (account) => state.operators.delegates.get(account.toLowerCase()) ?? null,
  };
}

/** `GET /v1/operator`: the key in effect and the election as the log mirrors it. */
export function operatorRoute(state: MockState): OperatorRoute {
  const operator = state.operators.adminKey(state.now);
  const { pending } = state.operators.named(state.now);
  const elected = pending === null ? null : { epoch: pending.epoch, candidate: pending.candidate, admin_key: pending.adminKey, effective_at: pending.effectiveAtMs, registry_effective_at: pending.effectiveAtMs };
  return { operator, pending_rotation: elected === null ? null : { address: elected.admin_key, effective_at: elected.effective_at }, rotation_enabled: true, last_election: elected };
}

/** The votes the visitor's accounts add to `candidate`: their whole stake, unstaking amounts excluded, as `Staking` counts it. */
function delegatedTo(state: MockState, candidate: string): bigint {
  let sum = 0n;
  for (const [account, chosen] of state.operators.delegates) if (chosen === candidate) sum += state.monkey.staked.get(account) ?? 0n;
  return sum;
}

function candidateTable(state: MockState): CandidateTable {
  // `Staking.totalStaked`: what votes, so an unstake leaves it at once though it keeps earning through its cooldown.
  let totalStaked = state.monkey.otherStakedAt(state.now);
  for (const staked of state.monkey.staked.values()) totalStaked += staked;
  const candidates = state.operators.candidates.map(({ address, hostname, votes }) => {
    const cast = votes + delegatedTo(state, address);
    return { address, hostname, votes: cast, eligible: cast * 10_000n >= ELIGIBILITY_BPS * totalStaked };
  });
  const { candidate, hostname } = state.operators.named(state.now);
  return { inEffect: { candidate, hostname }, candidates, totalStaked };
}

/**
 * Stands in for `Staking.delegate`: the zero address clears the choice, so the stake abstains.
 * Error cases:
 * - the candidate is not one the simulated registry lists
 */
export function delegate(state: MockState, address: string, candidate: string): void {
  const key = address.toLowerCase();
  if (candidate === NO_CANDIDATE) {
    state.operators.delegates.delete(key);
    return;
  }
  if (!state.operators.candidates.some((listed) => listed.address === candidate)) throw new Error("The simulated registry lists no such candidate.");
  state.operators.delegates.set(key, candidate);
}
