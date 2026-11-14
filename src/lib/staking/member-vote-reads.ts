/**
 * The Governance tab's chain read of how the account and the members it delegates to stand on each
 * proposal shown (`member-votes.ts`), through the connected wallet, one call at a time behind its
 * other work. Read when the tab opens, when the proposals, the account's delegations or the wallet
 * change, after a vote, and every 15 seconds while the tab is visible for the open proposals' votes,
 * which a reorganised block could still undo; a failure backs off. A hidden tab reads nothing: a change
 * while it is hidden is read at the next five-second tick once it is seen. A wallet that reads no chain
 * reads nothing.
 */

import type { GovernanceWallet } from "../engine/governance-wallet";
import type { Wallet } from "../engine/wallet";
import { Backoff, WALLET_READ_EVERY_MS } from "../monkey/live-reads";
import type { OperatorReads } from "../monkey/operators";
import type { ConsoleStore } from "../store/store";
import type { DelegationReads } from "./delegation-reads";
import type { GovernanceReads } from "./governance-reads";
import { RETRY_TICK_MS } from "./history-reads";
import { fold, MAX_CALLS, NO_FACTS, plan, type MemberVoteFacts, type VoteAnswer, type VoteCall, type VoteTarget } from "./member-votes";

export interface MemberVotesState {
  /** The account whose delegations name the members; null with no wallet. */
  account: string | null;
  /** The proposal the account last voted on from this tab, where the `governance` notice shows. */
  votingOn: number | null;
  /** The proposal the account's last vote from this tab landed on, which the tab reads out wherever the proposal now sits. */
  landed: number | null;
  /** The vote contract the facts are for. */
  vote: string | null;
  /** `unavailable` for a wallet that reads no chain, or none. */
  status: "idle" | "ready" | "failed" | "unavailable";
  facts: MemberVoteFacts;
  error: string | null;
}

const IDLE: MemberVotesState = { account: null, votingOn: null, landed: null, vote: null, status: "idle", facts: NO_FACTS, error: null };

/** The vote contract and the proposals the tab shows, open ones first, from the node's two reads at `nowMs`. */
export function targetsOf(operators: OperatorReads, governance: GovernanceReads, nowMs: number): { vote: string | null; targets: VoteTarget[] } {
  const proposals = operators.getSnapshot().list.value?.proposals ?? null;
  const held = governance.getSnapshot().value?.view ?? null;
  const open = (proposals?.open ?? []).map((proposal) => ({ id: proposal.id, setId: proposal.setId, open: proposal.closesAtMs > nowMs }));
  const passed = [...(held?.waiting ?? []), ...(held?.inForce ?? [])].map((change) => ({ id: change.id, setId: null, open: false }));
  return { vote: proposals?.vote ?? held?.vote ?? null, targets: [...open, ...passed] };
}

/** What tells one call from another within a read. */
const callKey = (call: VoteCall): string => (call.kind === "set" ? `set:${call.setId}` : call.kind === "proposal" ? `proposal:${call.id}` : `voted:${call.id}:${call.member}`);

/** One call's answer from the wallet. */
async function ask(governance: GovernanceWallet, vote: string, call: VoteCall): Promise<VoteAnswer> {
  switch (call.kind) {
    case "proposal": return { kind: "proposal", id: call.id, proposal: await governance.proposal(vote, call.id) };
    case "set": return { kind: "set", setId: call.setId, members: new Map((await governance.set(vote, call.setId)).map((member) => [member.candidate, member.weight])) };
    case "voted": return { ...call, voted: await governance.voted(vote, call.id, call.member) };
    default: {
      const never: never = call;
      throw new Error(`Unknown vote read ${String(never)}.`);
    }
  }
}

/** The Governance tab's chain read of how the account and the members it delegates to voted. */
export class MemberVoteReads {
  private state: MemberVotesState = IDLE;
  private readonly listeners = new Set<() => void>();
  /** Counts openings and wallet changes; a read begun before one never writes after it. */
  private cycle = 0;
  private open = false;
  /** A read waiting for the wallet, which another ask joins until it has begun. */
  private reading: { wallet: Wallet; cycle: number; read: Promise<void>; started: boolean } | null = null;
  private readonly backoff = new Backoff();

  constructor(
    private readonly store: ConsoleStore,
    private readonly operators: OperatorReads,
    private readonly governance: GovernanceReads,
    private readonly delegations: DelegationReads,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): MemberVotesState => this.state;

  private set(partial: Partial<MemberVotesState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  /** The account and the candidates its delegations name, as the chain last reported them for it, lowercase and once each. */
  private members(account: string): string[] {
    const read = this.delegations.getSnapshot();
    const delegated = read.account?.toLowerCase() === account ? (read.read.value?.delegations ?? []).map((delegation) => delegation.candidate.toLowerCase()) : [];
    return [...new Set([account.toLowerCase(), ...delegated])];
  }

  /** What the reads are for, as text that changes when the contract, a proposal shown, its being open, or a member does. */
  private shown(): string {
    const { vote, targets } = targetsOf(this.operators, this.governance, this.store.getSnapshot().now);
    const account = this.store.liveWallet?.address.toLowerCase() ?? null;
    return JSON.stringify([vote, targets, account === null ? [] : this.members(account)]);
  }

  /** Starts the reads, and returns what stops them. While `isHidden` says the tab is hidden the timer reads nothing. What was read stays: a set never changes, and a vote read once final stays so. */
  start(isHidden: () => boolean): () => void {
    this.open = true;
    this.cycle += 1;
    this.backoff.reset();
    const refresh = () => void this.refresh();
    // The node's reads and the delegations notify on every answer; only a change in what is shown, or in the wallet, needs a read.
    // Taken now, so the store's first patch after the start is no change and asks for no second read.
    let shown = this.shown();
    let wallet = this.store.liveWallet;
    let pending = false;
    const changed = () => {
      const now = this.shown();
      if (now === shown && this.store.liveWallet === wallet) return;
      shown = now;
      wallet = this.store.liveWallet;
      if (isHidden()) pending = true;
      else refresh();
    };
    const stops = [this.operators.subscribe(changed), this.governance.subscribe(changed), this.delegations.subscribe(changed), this.store.subscribe(changed)];
    let next = Date.now() + WALLET_READ_EVERY_MS;
    const timer = setInterval(() => {
      if (isHidden() || (!pending && (Date.now() < next || !this.backoff.ready()))) return;
      pending = false;
      next = Date.now() + WALLET_READ_EVERY_MS;
      refresh();
    }, RETRY_TICK_MS);
    refresh();
    return () => {
      this.open = false;
      this.cycle += 1;
      clearInterval(timer);
      for (const stop of stops) stop();
      this.reading = null;
    };
  }

  /** Reads what the facts lack for the proposals shown, behind the wallet's earlier work. */
  refresh(): Promise<void> {
    if (!this.open) return Promise.resolve();
    const wallet = this.store.liveWallet;
    const account = wallet?.address.toLowerCase() ?? null;
    if (account !== this.state.account) {
      this.cycle += 1;
      this.set({ account, status: "idle", error: null });
    }
    const governance = wallet?.governance;
    if (wallet === null || account === null || governance === undefined || wallet.readOnly === true) {
      if (this.state.status !== "unavailable") this.set({ status: "unavailable" });
      return Promise.resolve();
    }
    const { vote } = targetsOf(this.operators, this.governance, this.store.getSnapshot().now);
    // No vote contract shown: nothing to read, which the tab takes as answered.
    if (vote === null) {
      if (this.state.status === "idle") this.set({ status: "ready" });
      return Promise.resolve();
    }
    // Another contract's facts say nothing of this one's.
    if (vote !== this.state.vote) this.set({ vote, facts: NO_FACTS, status: "idle" });
    const cycle = this.cycle;
    const waiting = this.reading;
    if (waiting !== null && waiting.wallet === wallet && waiting.cycle === cycle && !waiting.started) return waiting.read;
    const current = () => cycle === this.cycle && this.open && this.store.liveWallet === wallet && this.state.vote === vote;
    const entry = { wallet, cycle, read: Promise.resolve(), started: false };
    entry.read = this.store.monkeySession.walletWork.work(wallet, async () => {
      entry.started = true;
      if (!current()) return;
      // Planned when its turn comes, from what is shown then, and again as the sets land, each call once, at most `MAX_CALLS` in all.
      const { targets } = targetsOf(this.operators, this.governance, this.store.getSnapshot().now);
      const members = this.members(account);
      const asked = new Set<string>();
      let facts = this.state.facts;
      try {
        // On another chain the contract's address names something else: checked before the reads and after them.
        await governance.onChain();
        for (;;) {
          const calls = plan(facts, targets, members).filter((call) => !asked.has(callKey(call))).slice(0, MAX_CALLS - asked.size);
          if (calls.length === 0) break;
          for (const call of calls) {
            asked.add(callKey(call));
            const answer = await ask(governance, vote, call);
            if (!current()) return;
            facts = fold(facts, answer);
          }
        }
        if (asked.size > 0) {
          // A wallet that moved chain during the reads may have read another chain's contract: none of them is kept.
          await governance.onChain().catch((error: unknown) => {
            facts = this.state.facts;
            throw error;
          });
        }
        if (!current()) return;
        if (asked.size > 0) this.backoff.record(false);
        this.set({ facts, status: "ready", error: null });
      } catch (error) {
        this.backoff.record(true);
        if (current()) this.set({ facts, status: "failed", error: error instanceof Error ? error.message : "The wallet did not answer." });
      }
    }).finally(() => {
      if (this.reading === entry) this.reading = null;
    });
    this.reading = entry;
    return entry.read;
  }

  /** Marks proposal `id` as the one the `governance` notice speaks for, so it shows at that proposal's vote control. */
  voting(id: number): void {
    if (this.state.votingOn !== id) this.set({ votingOn: id });
  }

  /** After the account's vote on `id` landed: the contract holds it, so it shows at once and is read out, and the reads confirm it. */
  votedLanded(vote: string, id: number, member: string): void {
    if (vote !== this.state.vote) return;
    this.set({ landed: id, facts: fold(this.state.facts, { kind: "voted", id, member: member.toLowerCase(), open: true, voted: true }) });
  }
}
