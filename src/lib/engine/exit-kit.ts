/** Tests only: exit proofs shaped as the node serves them, and a wallet whose vault answers as a test says. */

import type { ExitRecord, ExitStorage } from "./exit-file";
import type { ExitCheck, ExitClaimFacts, ExitProof, ExitStep, ExitWallet, VaultExitFacts } from "./exit-types";

export const ACCOUNT = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
export const OTHER = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
export const VAULT = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
export const CHAIN_ID = 31337;
export const SCOPE = { chainId: CHAIN_ID, vault: VAULT, account: ACCOUNT };

/** A root for checkpoint `seq`, distinct per seq. */
export const rootAt = (seq: number): string => `0x${seq.toString(16).padStart(64, "0")}`;
const SIBLINGS = [`0x${"ab".repeat(32)}`, `0x${"cd".repeat(32)}`];

/** The proof at `seq` the node serves for an account holding a balance, one position in a USD market, one unpaid approval, one queued request, a distribution and a pending deposit. */
export function fullProof(seq: number, account = ACCOUNT): ExitProof {
  const root = rootAt(seq);
  const stand = { seq, root, siblings: SIBLINGS };
  return {
    seq, root,
    terms: { ...stand, terms: { deposit_cursor: 3, deposit_base: 2, pending: "25", held: "0", unheld: "0", held_receipts: "5000", gaps: [] } },
    account: {
      ...stand, account,
      leaf: { balance: "5000", withdrawal_nonce: 1, toxicity_bps: 0, open_positions: 1 },
      positions: [{ market: 1, position: { qty: "0.01", entry: "100000" }, siblings: SIBLINGS }],
      markets: [{ market: 1, leaf: { mark: "101000", quote_currency: { currency: "usd" }, fx_mark: null, client_qty: "0.01", client_cost: "1000", state_hash: `0x${"11".repeat(32)}` }, siblings: SIBLINGS }],
    },
    approvals: [{ ...stand, approval: { account, amount: "50", nonce: 1, approved_seq: seq - 10 } }],
    queued: [{ ...stand, queued: { account, amount: "20", remaining: "20", requested_seq: seq - 5, ticket: 7 } }],
    distribution: { ...stand, account, entitled: "3000000" },
    pending_deposits: [{ ...stand, chain_ref: "0xfeed:1", deposit: { deposit_id: 2, account, payer: account, amount: "25" } }],
  };
}

/** The node's answer at `seq` for an account it holds nothing for. */
export function emptyProof(seq: number): ExitProof {
  const root = rootAt(seq);
  return { seq, root, terms: { seq, root, terms: { deposit_cursor: 1, deposit_base: 1, pending: "0", held: "0", unheld: "0", held_receipts: "0", gaps: [] }, siblings: SIBLINGS }, account: null, approvals: [], queued: [], distribution: null, pending_deposits: [] };
}

/** A record of `fullProof(seq)`, as the vault's check leaves it. */
export function recordAt(seq: number, checkpointAt = 1_000): ExitRecord {
  return { ...SCOPE, proof: fullProof(seq), checkpointAt, accountClaim: 5_010_000_000n, distributionOwed: 3_000_000n, paidApprovals: [] };
}

/** A vault at checkpoint `seq`, in no exit, with the stack's thirty-day exit schedule. */
export function factsAt(seq: number, change: Partial<VaultExitFacts> = {}): VaultExitFacts {
  return { hasCheckpoint: true, latestSeq: seq, latestRoot: rootAt(seq), lastCheckpointAt: 1_000, exitPeriod: 2_592_000, claimWindow: 2_592_000, exitStartedAt: 0, chainNow: 1_060, ...change };
}

export const NO_CLAIMS: ExitClaimFacts = { accountRegistered: false, distributionRegistered: false, queuedRegistered: [], approvalsUsed: [], refunded: [], exitClaim: 0n, exitDistributionClaim: 0n, distributionPaid: 0n, unheld: [], unheldComplete: true };

/** A browser storage in a map, which can be made to refuse. */
export function exitStorage(): ExitStorage & { held: Map<string, string>; refuseWrites: boolean } {
  const held = new Map<string, string>();
  const storage = {
    held,
    refuseWrites: false,
    getItem: (key: string) => held.get(key) ?? null,
    setItem(key: string, value: string) {
      if (storage.refuseWrites) throw new Error("the quota is exceeded");
      held.set(key, value);
    },
    removeItem: (key: string) => void held.delete(key),
  };
  return storage;
}

/** A vault as a wallet reads it: a test moves `vault` and `claimsHeld`, and says what `check` answers. */
export class FakeExitWallet implements ExitWallet {
  vault: VaultExitFacts = factsAt(100);
  claimsHeld: ExitClaimFacts = NO_CLAIMS;
  staked = false;
  /** What the verifier says; by default it accepts the proof as it stands. */
  verdict: (proof: ExitProof, root: string) => ExitCheck = (proof) => ({ ok: true, paidApprovals: [], accountClaim: proof.account === null ? 0n : 5_010_000_000n, distributionOwed: proof.distribution === null ? 0n : BigInt(proof.distribution.entitled) });
  factsError: Error | null = null;
  checkError: Error | null = null;
  sendError: Error | null = null;
  claimsError: Error | null = null;
  claimsReads = 0;
  factsReads = 0;
  checks: string[] = [];
  sent: ExitStep[] = [];
  /** What the vault's clock says a sent step changes; a test may add to it. */
  onSend: (step: ExitStep) => void = () => undefined;
  async facts(): Promise<VaultExitFacts> {
    this.factsReads++;
    if (this.factsError !== null) throw this.factsError;
    return this.vault;
  }
  async check(proof: ExitProof, root: string): Promise<ExitCheck> {
    this.checks.push(root);
    if (this.checkError !== null) throw this.checkError;
    return this.verdict(proof, root);
  }
  /** As the vault answers it: what it holds of a proof's parts only when asked about that proof. */
  async claims(proof: ExitProof | null): Promise<ExitClaimFacts> {
    this.claimsReads++;
    if (this.claimsError !== null) throw this.claimsError;
    return proof === null ? { ...this.claimsHeld, accountRegistered: false, distributionRegistered: false, queuedRegistered: [], approvalsUsed: [], refunded: [] } : this.claimsHeld;
  }
  async stakeHeld(): Promise<boolean> { return this.staked; }
  async send(step: ExitStep): Promise<{ hash: string; paid: bigint | null }> {
    if (this.sendError !== null) throw this.sendError;
    this.sent.push(step);
    this.onSend(step);
    return { hash: `0x${String(this.sent.length).padStart(64, "0")}`, paid: step.kind === "claim" ? 4_800_000_000n : null };
  }
}
