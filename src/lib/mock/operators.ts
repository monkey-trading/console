/**
 * The simulated operator registry and what the node mirrors of it: a full list of candidates, the
 * operator in effect, and an election waiting out its notice, as `OperatorRegistry.sol`,
 * `GET /v1/operator` and `GET /v1/operators` hold them. Accounts delegate amounts of their stake to
 * candidates, as `Staking` keeps them (monkey-trading/engine#586), and the election takes effect when
 * the mock's clock reaches its time.
 */

import { keccak256, stringToHex } from "viem";

import { NO_CANDIDATE, type DeploymentReads, type NamedOperator, type PendingElection } from "../engine/registry";
import type { Delegation } from "../engine/staking";
import { CANDIDATE_LIMIT, type OperatorList } from "../engine/staking-reads";
import type { OperatorRoute } from "../engine/stats-types";
import { MONKEY_UNIT } from "../format";
import { mulberry32, SEED } from "../prng";
import { applyChange, delegatedOf, delegationTo, unstakeTakes } from "../staking/delegations";
import type { MockState } from "./state";

const DAY_MS = 86_400_000;
/** The share of total stake a candidate needs to be eligible, in basis points; a development value, as the registry's parameters are decided apart. */
const ELIGIBILITY_BPS = 500n;
/** The stake other delegators give the four candidates that lead, in whole MONKEY, so the visitor's own moves the figures without deciding them. */
const LEADERS = [
  { name: "alpha", votes: 620_000n, bond: 50_000n },
  { name: "bravo", votes: 780_000n, bond: 40_000n },
  { name: "charlie", votes: 240_000n, bond: 25_000n },
  { name: "delta", votes: 30_000n, bond: 10_000n },
] as const;
/** The most whole MONKEY each of the other candidates is delegated, so every vote stays within the stake the mock counts. */
const TAIL_VOTES = 5_000;

/** A stand-in address from a stand-in name; these sit where a chain would answer. */
const addressOf = (name: string, role: string): string => `0x${Array.from(`${name}.${role}`, (c) => c.charCodeAt(0).toString(16)).join("").padEnd(40, "0").slice(0, 40)}`;
/** A stand-in hash of `text`, lowercase `0x` hex: the generated candidates' addresses and every release, distinct even shortened. */
const hashOf = (text: string): string => keccak256(stringToHex(text));
const hostnameOf = (name: string): string => `${name}.operators.example`;

/** A candidate the simulated registry lists. */
interface MockCandidate {
  address: string;
  bond: bigint;
  release: string;
  registration: number;
  handoverEndpoint: string;
  adminKey: string;
  hostname: string;
  /** MONKEY base units other delegators give it. */
  votes: bigint;
}

/** The registry's full list: the four leaders, then candidates with a little stake each, in the order they registered. */
function mockCandidates(): MockCandidate[] {
  const rand = mulberry32(SEED + 271);
  const tail = Array.from({ length: CANDIDATE_LIMIT - LEADERS.length }, (_, i) => ({
    name: `node-${String(i + LEADERS.length + 1).padStart(3, "0")}`,
    votes: rand() < 0.2 ? 0n : BigInt(Math.floor(rand() * TAIL_VOTES)),
    bond: 10_000n + BigInt(Math.floor(rand() * 30)) * 1_000n,
  }));
  return [...LEADERS, ...tail].map(({ name, votes, bond }, registration) => ({
    address: registration < LEADERS.length ? addressOf(name, "candidate") : hashOf(`${name}.candidate`).slice(0, 42),
    adminKey: registration < LEADERS.length ? addressOf(name, "admin") : hashOf(`${name}.admin`).slice(0, 42),
    hostname: hostnameOf(name), votes: votes * MONKEY_UNIT,
    bond: bond * MONKEY_UNIT, release: hashOf(`${name}.release`), registration, handoverEndpoint: `https://${hostnameOf(name)}:9443/handover`,
  }));
}

export class MockOperators {
  /** Each account's delegations, in the order `Staking.delegationsOf` would list them. */
  readonly delegations = new Map<string, Delegation[]>();
  readonly candidates: readonly MockCandidate[] = mockCandidates();
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
  };
}

/** `GET /v1/operator`: the key in effect and the election as the log mirrors it. */
export function operatorRoute(state: MockState): OperatorRoute {
  const operator = state.operators.adminKey(state.now);
  const { pending } = state.operators.named(state.now);
  const elected = pending === null ? null : { epoch: pending.epoch, candidate: pending.candidate, admin_key: pending.adminKey, effective_at: pending.effectiveAtMs, registry_effective_at: pending.effectiveAtMs };
  return { operator, pending_rotation: elected === null ? null : { address: elected.admin_key, effective_at: elected.effective_at }, rotation_enabled: true, last_election: elected };
}

/** What the visitor's accounts delegate to `candidate`, as `Staking.votes` adds them. */
function delegatedToCandidate(state: MockState, candidate: string): bigint {
  let sum = 0n;
  for (const delegations of state.operators.delegations.values()) sum += delegationTo(delegations, candidate);
  return sum;
}

/** The simulated chain's block for `ms`: one every twelve seconds, final at once. */
function blockAt(ms: number): OperatorList["block"] {
  const number = Math.floor(ms / 12_000);
  return { number, hash: hashOf(`block-${number}`), time_ms: number * 12_000 };
}

/** `GET /v1/operators`: the simulated registry through its lens, at the mock's latest block. */
export function operatorList(state: MockState): OperatorList {
  // `Staking.totalStaked`: what votes, so an unstake leaves it at once though it keeps earning through its cooldown.
  let totalStaked = state.monkey.otherStakedAt(state.now);
  for (const staked of state.monkey.staked.values()) totalStaked += staked;
  const named = state.operators.named(state.now);
  const operator = (candidate: string, sinceMs: number) => {
    const listed = state.operators.candidates.find((entry) => entry.address === candidate);
    return { candidate, admin_key: listed?.adminKey ?? NO_CANDIDATE, release: listed?.release ?? `0x${"0".repeat(64)}`, since_ms: sinceMs };
  };
  const pending = named.pending;
  const candidates = state.operators.candidates.map(({ address, adminKey, hostname, votes, bond, release, registration, handoverEndpoint }) => {
    const cast = votes + delegatedToCandidate(state, address);
    const role = address === named.candidate ? ("operator" as const) : address === pending?.candidate ? ("elected" as const) : ("candidate" as const);
    return {
      address, admin_key: adminKey, enclave: hashOf(`${address}.enclave`).slice(0, 42), self_bond: bond.toString(), release, registration,
      api_hostname: hostname, handover_endpoint: handoverEndpoint, votes: cast.toString(), eligible: cast * 10_000n >= ELIGIBILITY_BPS * totalStaked, role,
    };
  });
  return {
    block: blockAt(state.now), registry: addressOf("registry", "contract"), lens: addressOf("lens", "contract"), rotation_enabled: named.rotationEnabled,
    parameters: { epoch_length_secs: 604_800, min_term_secs: 0, finality_margin_secs: 900, margin_bps: 1_000, eligibility_bps: Number(ELIGIBILITY_BPS), quorum_bps: 2_000, max_candidates: CANDIDATE_LIMIT, min_self_bond: (10_000n * MONKEY_UNIT).toString(), liveness_timeout_secs: 86_400 },
    open_epoch: 42, open_epoch_start_ms: state.now - DAY_MS, total_staked: totalStaked.toString(),
    operator_in_effect: operator(named.candidate, named.sinceMs), named_operator: operator(named.candidate, named.sinceMs),
    pending_election: pending === null ? null : { epoch: pending.epoch, candidate: pending.candidate, admin_key: pending.adminKey, release: operator(pending.candidate, 0).release, effective_at_ms: pending.effectiveAtMs, promoted: pending.promoted },
    pending_promotion: false, candidates, proposals: state.governance.openProposals(state.now),
  };
}

/** The simulated account's delegations. */
export function delegationsOf(state: MockState, address: string): Delegation[] {
  return state.operators.delegations.get(address.toLowerCase()) ?? [];
}

/** Keeps `delegations` as the account's, and none for an empty list, as the contract's set drops an emptied one. */
function setDelegations(state: MockState, key: string, delegations: Delegation[]): void {
  if (delegations.length === 0) state.operators.delegations.delete(key);
  else state.operators.delegations.set(key, delegations);
}

/**
 * Stands in for `Staking.delegate`, `undelegate` and `redelegate`: `from` gives `amount` (the
 * undelegated stake when null) and `to` takes it (the undelegated stake when null). Like the
 * contract, it takes any address but the zero one: whether it is a candidate is the registry's matter.
 * Error cases:
 * - the amount is not positive, or more than `from` holds; `to` is the zero address, or is `from`
 */
export function moveDelegation(state: MockState, address: string, from: string | null, to: string | null, amount: bigint): void {
  const key = address.toLowerCase();
  let delegations = delegationsOf(state, key);
  if (amount <= 0n) throw new Error("The amount must be more than zero.");
  if (to === NO_CANDIDATE) throw new Error("A delegation goes to a candidate's address, not the zero address.");
  if (to !== null && to === from) throw new Error("A delegation moves to another candidate than its own.");
  const held = from === null ? (state.monkey.staked.get(key) ?? 0n) - delegatedOf(delegations) : delegationTo(delegations, from);
  if (amount > held) throw new Error(from === null ? "Your undelegated stake is less than that." : "Your delegation there is less than that.");
  if (from !== null) delegations = applyChange(delegations, { candidate: from, amount: -amount });
  if (to !== null) delegations = applyChange(delegations, { candidate: to, amount });
  setDelegations(state, key, delegations);
}

/** What `Staking.startUnstake(amount)` takes from the account's delegations, applied as the contract does, from the last to the first. */
export function reduceForUnstake(state: MockState, address: string, amount: bigint): void {
  const key = address.toLowerCase();
  const staked = state.monkey.staked.get(key) ?? 0n;
  if (amount <= 0n || amount > staked) return; // the unstake itself refuses it, and says why
  let delegations = delegationsOf(state, key);
  const { reductions } = unstakeTakes(staked, delegations, amount);
  for (const reduction of [...reductions].reverse()) delegations = applyChange(delegations, { candidate: reduction.candidate, amount: -reduction.amount });
  setDelegations(state, key, delegations);
}
