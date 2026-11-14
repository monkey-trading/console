/**
 * The simulated vote contract and what the node mirrors of it (monkey-trading/engine#548, from V56):
 * a rotation set of the four leading candidates, a normal and a fast-path proposal taking votes, a
 * passed change due three minutes after the node's clock starts, and a fast-path restriction in
 * force, as `GET /v1/operators`' proposals, `GET /v1/house/state`'s governance and the contract's own
 * reads hold them. The mock's clock applies a due change and lapses a restriction; a proposal passes
 * as the contract passes it, once its yes weight is more than two thirds of its set's; and a
 * restriction in force holds its market's stress level or stops new risk there, as the engine's
 * values in force do.
 */

import type { ChainProposal, SetMember } from "../engine/governance-wallet";
import type { AdminCommandWire, GovernanceWire, LimitWire, OpenProposalsWire } from "../engine/governance-types";
import { MONKEY_UNIT } from "../format";
import { passes } from "../staking/governance";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** A normal change's notice and a restriction's lifetime, as the engine's V56 rules and a deployment's config set them. */
const NOTICE_MS = 7 * DAY_MS;
const RESTRICTION_TTL_MS = DAY_MS;
/** The set's members' weights, in whole MONKEY, in the leaders' order. */
const WEIGHTS = [400_000n, 300_000n, 200_000n, 100_000n] as const;
const HASH = `0x${"5e".repeat(32)}`;

interface Proposal {
  id: number;
  proposer: string;
  fast: boolean;
  opensAtMs: number;
  closesAtMs: number;
  command: AdminCommandWire;
  voters: Set<string>;
  passed: boolean;
}

/** The restriction a passed fast-path stress floor or reduce-only holds; the mock's fast-path proposals carry no other. */
function limitOf(command: AdminCommandWire): LimitWire | null {
  const market = typeof command.market === "number" ? command.market : null;
  if (command.action === "set_stress_floor" && typeof command.level === "number") return { kind: "stress_floor", market, level: command.level };
  if (command.action === "set_reduce_only") return { kind: "reduce_only", market };
  return null;
}

export class MockGovernance {
  /** The simulated vote contract's address. */
  readonly vote = `0x${"7a".repeat(20)}`;
  private readonly members: ReadonlyMap<string, bigint>;
  private readonly proposals = new Map<number, Proposal>();
  private pending: { proposal: number; command: AdminCommandWire; appliesAtMs: number }[];
  /** In force from `fromMs`, when the node logged it, to `expiresAtMs`. */
  private readonly restrictions = new Map<number, { limit: LimitWire; fromMs: number; expiresAtMs: number }>();

  /** The node's clock starts at `startMs`; `candidates` are the registry's, the first four of which make the set. */
  constructor(startMs: number, candidates: readonly { address: string }[]) {
    const members = candidates.slice(0, WEIGHTS.length).map((candidate) => candidate.address);
    this.members = new Map(members.map((member, i) => [member, (WEIGHTS[i] ?? 0n) * MONKEY_UNIT]));
    const [alpha = "", bravo = "", , delta = ""] = members;
    const ceiling: AdminCommandWire = { action: "adopt_close_spread_ceiling", market: 3, max_close_spread_bps: 12, effective_at: startMs + 3 * MINUTE_MS };
    const usFloor: AdminCommandWire = { action: "set_stress_floor", market: 4, level: 1 };
    const relisting: AdminCommandWire = { action: "upsert_market", id: 1, symbol: "BTC-USD", margin_tiers: [{ up_to: "1000000", bps: 200 }, { up_to: null, bps: 500 }], house_cap_bps: 2500 };
    const goldReduceOnly: AdminCommandWire = { action: "set_reduce_only", market: 5, reduce_only: true };
    const proposal = (id: number, fast: boolean, opensAtMs: number, windowMs: number, command: AdminCommandWire, voters: string[], passed: boolean) =>
      this.proposals.set(id, { id, proposer: voters[0] ?? alpha, fast, opensAtMs, closesAtMs: opensAtMs + windowMs, command, voters: new Set(voters), passed });
    proposal(5, false, startMs - 8 * DAY_MS, 3 * DAY_MS, ceiling, [alpha, bravo, delta], true);
    proposal(6, true, startMs - 2 * 3_600_000, 3_600_000, usFloor, [bravo, alpha], true);
    proposal(7, false, startMs - DAY_MS, 6 * DAY_MS, relisting, [alpha, delta], false);
    proposal(8, true, startMs - 10 * MINUTE_MS, 3_600_000, goldReduceOnly, [alpha], false);
    this.pending = [{ proposal: 5, command: ceiling, appliesAtMs: startMs + 3 * MINUTE_MS }];
    this.restrictions.set(6, { limit: { kind: "stress_floor", market: 4, level: 1 }, fromMs: startMs - 2 * 3_600_000, expiresAtMs: startMs - 2 * 3_600_000 + RESTRICTION_TTL_MS });
  }

  /** The tally of `proposal`: its voters' weights against the set's. */
  private tally(proposal: Proposal): { yes: bigint; total: bigint } {
    let yes = 0n;
    let total = 0n;
    for (const [member, weight] of this.members) {
      total += weight;
      if (proposal.voters.has(member)) yes += weight;
    }
    return { yes, total };
  }

  /** What the clock has done by `now`: due changes applied and lapsed restrictions dropped, as the engine does at its next command. */
  private settle(now: number): void {
    this.pending = this.pending.filter((change) => change.appliesAtMs > now);
    for (const [id, restriction] of this.restrictions) if (restriction.expiresAtMs <= now) this.restrictions.delete(id);
  }

  /** The least stress level the restrictions in force at `now` hold `market` at; zero with none. */
  floorAt(market: number, now: number): number {
    this.settle(now);
    let level = 0;
    for (const { limit, fromMs } of this.restrictions.values()) {
      if (fromMs > now) continue;
      if (limit.kind === "stress_floor" && (limit.market === null || limit.market === market)) level = Math.max(level, limit.level);
    }
    return level;
  }

  /** Whether a restriction in force at `now` stops new risk in `market`. */
  reduceOnlyAt(market: number, now: number): boolean {
    this.settle(now);
    return [...this.restrictions.values()].some(({ limit, fromMs }) => fromMs <= now && limit.kind === "reduce_only" && (limit.market === null || limit.market === market));
  }

  /** `GET /v1/operators`' proposals at `now`: those still taking votes, newest first. */
  openProposals(now: number): OpenProposalsWire {
    const open = [...this.proposals.values()].filter((proposal) => !proposal.passed && proposal.closesAtMs > now).sort((a, b) => b.id - a.id);
    return {
      vote: this.vote, truncated: false,
      open: open.map((proposal) => {
        const { yes, total } = this.tally(proposal);
        return {
          id: proposal.id, proposer: proposal.proposer, set_id: 1, fast: proposal.fast, opens_at_ms: proposal.opensAtMs, closes_at_ms: proposal.closesAtMs,
          total_weight: total.toString(), yes_weight: yes.toString(), command_hash: HASH, command: proposal.command,
        };
      }),
    };
  }

  /** `GET /v1/house/state`'s governance at `now`. */
  houseGovernance(now: number): GovernanceWire {
    this.settle(now);
    return {
      config: { vote: this.vote, restriction_ttl_ms: RESTRICTION_TTL_MS },
      pending: this.pending.map((change) => ({ proposal: change.proposal, command: change.command, applies_at: change.appliesAtMs })),
      restrictions: Object.fromEntries([...this.restrictions].map(([id, restriction]) => [String(id), { limit: restriction.limit, command_hash: HASH, expires_at: restriction.expiresAtMs }])),
    };
  }

  /** `ParameterVote.proposalOf`: null for an id it never gave. */
  proposal(id: number): ChainProposal | null {
    const proposal = this.proposals.get(id);
    if (proposal === undefined) return null;
    const { yes, total } = this.tally(proposal);
    return { setId: 1, fast: proposal.fast, passed: proposal.passed, closesAtMs: proposal.closesAtMs, yes, total };
  }

  /** `OperatorSchedule.setOf`: the members of set 1, the only one adopted. */
  set(setId: number): SetMember[] {
    return setId === 1 ? [...this.members].map(([candidate, weight]) => ({ candidate, weight })) : [];
  }

  /** `ParameterVote.voted`. */
  voted(id: number, member: string): boolean {
    return this.proposals.get(id)?.voters.has(member.toLowerCase()) ?? false;
  }

  /**
   * `ParameterVote.vote` at `now` by `member`: a yes that passes the proposal, as the contract does,
   * waits out the notice or is in force at once, as the node mirrors it.
   * Error cases:
   * - the contract's refusals: no such proposal, already passed, closed, not a member, already voted
   */
  castVote(id: number, member: string, now: number): void {
    const proposal = this.proposals.get(id);
    const key = member.toLowerCase();
    if (proposal === undefined) throw new Error("The vote contract holds no proposal by this number, so nothing was sent.");
    if (proposal.passed) throw new Error("This proposal has already passed, so the vote contract takes no more votes on it and nothing was sent.");
    if (proposal.closesAtMs <= now) throw new Error("This proposal's voting window has closed, so the vote contract refused the vote and nothing was sent.");
    if (!this.members.has(key)) throw new Error("This account is not a member of the set this proposal opened under, so the vote contract refused the vote and nothing was sent.");
    if (proposal.voters.has(key)) throw new Error("The vote contract already holds this account's vote on this proposal, so nothing was sent.");
    proposal.voters.add(key);
    if (!passes(this.tally(proposal))) return;
    proposal.passed = true;
    const limit = limitOf(proposal.command);
    if (proposal.fast && limit !== null) this.restrictions.set(id, { limit, fromMs: now, expiresAtMs: now + RESTRICTION_TTL_MS });
    else if (!proposal.fast) this.pending.push({ proposal: id, command: proposal.command, appliesAtMs: now + NOTICE_MS });
  }
}
