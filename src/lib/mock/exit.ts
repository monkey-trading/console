/**
 * The simulated vault's exit and the mock node's exit route. The mock checks no proof and holds no
 * state tree, so its roots and siblings are stand-ins and its verifier accepts what its own route
 * serves; what it models is the exit's order, its windows and what each step is worth.
 */

import type { ExitCheck, ExitClaimFacts, ExitProof, ExitStep, ExitWallet, VaultExitFacts } from "../engine/exit-types";
import { fixedToWire } from "../fixed";
import { USDC_UNIT } from "../vault";
import { equityOf } from "./accounts";
import { mockHex } from "./hex";
import type { MockState } from "./state";

/** The stack's development exit period and claim window: thirty days each, in seconds. */
const EXIT_PERIOD = 2_592_000;
const CLAIM_WINDOW = 2_592_000;

const rootAt = (seq: number): string => `0x${mockHex(`exit-root:${seq}`, 32)}`;
const usdcUnits = (raw: bigint): bigint => raw / USDC_UNIT;

/** What the mock's vault holds of its exit, one account's registered claim per address. */
export class MockVaultExit {
  /** Whether the route answers past the vault's latest root, as a node whose newest checkpoint is not yet posted does. */
  private nodeAhead = false;
  /** Moves the vault's clock past the node's, as the controls ask. */
  private skipSeconds = 0;
  private startedAt = 0;
  private postedSeq = -1;
  private postedAt = 0;
  private forced = 0;
  private readonly claimsOf = new Map<string, ExitClaimFacts>();

  constructor(private readonly state: MockState) {}

  private nowSeconds(): number {
    return Math.floor(this.state.now / 1000) + this.skipSeconds;
  }

  /** The checkpoint the vault holds: frozen once the exit starts, and a new one when the node's own moves past it or the controls post one. */
  private latest(): { seq: number; root: string; at: number } {
    const seq = Math.max(this.state.postedSeq, this.forced);
    if (seq !== this.postedSeq && this.startedAt === 0) {
      this.postedSeq = seq;
      this.postedAt = this.nowSeconds();
    }
    return { seq: this.postedSeq, root: rootAt(this.postedSeq), at: this.postedAt };
  }

  /** The controls: a new checkpoint on the vault, as the poster lands one, with the route `ahead` of it or in step. */
  postCheckpoint(ahead: boolean): void {
    this.nodeAhead = ahead;
    this.forced = this.state.seq;
  }

  /** The controls: no checkpoint for the whole exit period. */
  comeDue(): void {
    this.skipSeconds += EXIT_PERIOD;
  }

  /** The controls: the claim window runs out. */
  closeWindow(): void {
    this.skipSeconds += CLAIM_WINDOW;
  }

  /** `GET /v1/accounts/{address}/exit`: the stand-in proof, or null with no checkpoint yet (the node's 404). */
  proof(address: string): ExitProof | null {
    const { seq: posted, root: postedRoot } = this.latest();
    if (posted <= 0) return null;
    const seq = this.nodeAhead ? posted + 1 : posted;
    const root = this.nodeAhead ? rootAt(seq) : postedRoot;
    const key = address.toLowerCase();
    const siblings = [`0x${mockHex(`sibling:${root}`, 32)}`];
    const held = this.state.accounts.get(key);
    const entitled = this.state.monkey.distEntitled.get(key);
    const stand = { seq, root, siblings };
    return {
      seq, root,
      terms: { ...stand, terms: { deposit_cursor: 0, deposit_base: 0, pending: "0", held: "0", unheld: "0", held_receipts: "0", gaps: [] } },
      account: held === undefined || !this.state.credited.has(key) ? null : {
        ...stand, account: key,
        leaf: { balance: fixedToWire(held.balance), withdrawal_nonce: held.approvalNonce, toxicity_bps: 0, open_positions: held.positions.size },
        positions: [...held.positions].map(([market, position]) => ({ market, position: { qty: fixedToWire(position.qty), entry: fixedToWire(position.entry) }, siblings })),
        markets: [...held.positions.keys()].map((market) => ({ market, leaf: { mark: fixedToWire(this.state.markets.get(market)?.mid ?? 0n), quote_currency: { currency: "usd" as const }, fx_mark: null, client_qty: "0", client_cost: "0", state_hash: root }, siblings })),
      },
      approvals: [],
      queued: this.state.queue.filter((entry) => entry.account.toLowerCase() === key).map((entry) => ({ ...stand, queued: { account: key, amount: fixedToWire(entry.amount), remaining: fixedToWire(entry.remaining), requested_seq: entry.requestedSeq } })),
      distribution: entitled === undefined ? null : { ...stand, account: key, entitled: entitled.toString() },
      pending_deposits: [],
    };
  }

  private held(key: string): ExitClaimFacts {
    return this.claimsOf.get(key) ?? { accountRegistered: false, distributionRegistered: false, queuedRegistered: [], approvalsUsed: [], refunded: [], mismatched: [], exitClaim: 0n, exitDistributionClaim: 0n, distributionPaid: this.state.monkey.distClaimed.get(key) ?? 0n, unheld: [], unheldComplete: true };
  }

  private update(key: string, change: Partial<ExitClaimFacts>): void {
    this.claimsOf.set(key, { ...this.held(key), ...change });
  }

  /** What the account's balance and positions would register for: its equity, floored at zero. */
  private accountWorth(key: string): bigint {
    const held = this.state.accounts.get(key);
    const equity = held === undefined ? 0n : equityOf(this.state, held);
    return equity > 0n ? usdcUnits(equity) : 0n;
  }

  /** The wallet's side of the simulated exit. */
  wallet(address: string): ExitWallet {
    const key = address.toLowerCase();
    const facts = (): VaultExitFacts => {
      const { seq, root, at } = this.latest();
      return { hasCheckpoint: seq > 0, latestSeq: seq, latestRoot: root, lastCheckpointAt: at, exitPeriod: EXIT_PERIOD, claimWindow: CLAIM_WINDOW, exitStartedAt: this.startedAt, chainNow: this.nowSeconds() };
    };
    return {
      facts: async () => facts(),
      check: async (proof: ExitProof, root: string): Promise<ExitCheck> => {
        if (proof.root !== root) return { ok: false, reason: "its exit terms do not prove against the vault's root" };
        const paid = this.state.monkey.distClaimed.get(key) ?? 0n;
        const entitled = BigInt(proof.distribution?.entitled ?? "0");
        const distributionOwed = entitled > paid ? entitled - paid : 0n;
        return { ok: true, paidApprovals: [], accountClaim: proof.account === null ? 0n : this.accountWorth(key), distributionOwed, finalPaidApprovals: [], finalDistributionOwed: distributionOwed };
      },
      claims: async () => this.held(key),
      stakeHeld: async () => (this.state.monkey.staked.get(key) ?? 0n) > 0n,
      send: async (step: ExitStep) => {
        const hash = `0x${mockHex(`exit-${step.kind}-${key}-${this.state.seq}`, 32)}`;
        const now = this.held(key);
        switch (step.kind) {
          case "start":
            this.startedAt = this.nowSeconds();
            return { hash, paid: null };
          case "account":
            this.update(key, { accountRegistered: true, exitClaim: now.exitClaim + step.amount });
            return { hash, paid: null };
          case "approval":
            this.update(key, { approvalsUsed: [...now.approvalsUsed, step.proof.approval.nonce], exitClaim: now.exitClaim + step.amount });
            return { hash, paid: null };
          case "queued":
            this.update(key, { queuedRegistered: [...now.queuedRegistered, step.proof.queued.requested_seq], exitClaim: now.exitClaim + step.amount });
            return { hash, paid: null };
          case "distribution":
            this.update(key, { distributionRegistered: true, exitDistributionClaim: step.amount });
            return { hash, paid: null };
          case "refund":
            this.update(key, { refunded: [...now.refunded, step.proof.deposit.deposit_id] });
            return { hash, paid: null };
          case "refund-unheld":
            return { hash, paid: null };
          case "claim":
            this.update(key, { exitClaim: 0n, exitDistributionClaim: 0n });
            return { hash, paid: now.exitClaim + now.exitDistributionClaim };
          default:
            return step satisfies never;
        }
      },
    };
  }
}
