/**
 * The exit against the vault's last posted root: what `GET /v1/accounts/{address}/exit` answers, field
 * for field as `engine_core::merkle::ExitProof` serializes (monkey-trading/engine#48), what the vault
 * says about its exit, and what a wallet does with both. Decimals stay wire text here;
 * `exit-abi.ts` turns them into the vault's raw units.
 */

import type { Progress } from "./wallet";
import type { Address } from "./types";

/** `engine_core::merkle::ExitTerms`, with its proof. */
export interface ExitTermsProof {
  seq: number;
  root: string;
  terms: { deposit_cursor: number; deposit_base: number; pending: string; held: string; unheld: string; held_receipts: string; gaps: number[] };
  siblings: string[];
}

/** `QuoteCurrency`, tagged by `currency`; a quote currency other than USD names the market its index converts at. */
export type ExitQuoteCurrency = { currency: "usd" } | { currency: "eur" | "gbp" | "jpy"; fx_market: number };

/** `AccountProof`: the account's leaf, with one position and market leaf per open position, in market order. */
export interface ExitAccountProof {
  seq: number;
  root: string;
  account: Address;
  leaf: { balance: string; unfinalised_deposits?: string; withdrawal_nonce: number; toxicity_bps: number; open_positions: number; toxicity_fraction?: string; toxicity_history?: string };
  siblings: string[];
  positions: { market: number; position: { qty: string; entry: string }; siblings: string[] }[];
  markets: { market: number; leaf: { mark: string | null; quote_currency: ExitQuoteCurrency; fx_mark: string | null; client_qty: string; client_cost: string; state_hash: string }; siblings: string[] }[];
}

/** `WithdrawalApprovalProof`: an approval the root holds; the vault's `usedNonces` says whether it was paid. */
export interface ExitApprovalProof {
  seq: number;
  root: string;
  approval: { account: Address; amount: string; nonce: number; approved_seq: number };
  siblings: string[];
}

/** `QueuedWithdrawalProof`: a queued request the root holds; `ticket` is left out of the wire while zero. */
export interface ExitQueuedProof {
  seq: number;
  root: string;
  queued: { account: Address; amount: string; remaining: string; requested_seq: number; ticket?: number };
  siblings: string[];
}

/** `DistributionProof`: `entitled` is cumulative, in USDC base units, as a decimal string. */
export interface ExitDistributionProof {
  seq: number;
  root: string;
  account: Address;
  entitled: string;
  siblings: string[];
}

/** `PendingDepositProof`: a deposit the root holds pending, keyed by its receipt's reference. */
export interface ExitPendingProof {
  seq: number;
  root: string;
  chain_ref: string;
  deposit: { deposit_id: number; account: Address | null; payer: Address | null; amount: string };
  siblings: string[];
}

/** `ExitProof`: every proof an account exits with against one root. */
export interface ExitProof {
  seq: number;
  root: string;
  terms: ExitTermsProof;
  account: ExitAccountProof | null;
  approvals: ExitApprovalProof[];
  queued: ExitQueuedProof[];
  distribution: ExitDistributionProof | null;
  pending_deposits: ExitPendingProof[];
}

/** What the vault says about its exit now, read through the wallet; times are chain seconds. */
export interface VaultExitFacts {
  hasCheckpoint: boolean;
  latestSeq: number;
  /** `latestRoot()`, lowercase. What every exit claim proves against, and after the exit starts, its final root. */
  latestRoot: string;
  lastCheckpointAt: number;
  exitPeriod: number;
  claimWindow: number;
  /** Zero until the exit starts. */
  exitStartedAt: number;
  /** The latest block's timestamp: the vault's own clock, which the device's may disagree with. */
  chainNow: number;
}

/** Where the vault's exit stands, as `Vault.startExit` and `_requireClaimWindow` judge it. */
export type ExitPhase =
  /** Checkpoints are current, or too recent for the exit to start. */
  | "none"
  /** No checkpoint for the exit period: anyone may start the exit. */
  | "due"
  /** Started: claims register until the window closes. */
  | "open"
  /** The window has closed: registered claims are paid. */
  | "closed";

/** The vault's record of what has been done with one proof, read through the wallet. */
export interface ExitClaimFacts {
  accountRegistered: boolean;
  distributionRegistered: boolean;
  /** The queued requests registered, by `requested_seq`. */
  queuedRegistered: number[];
  /** The approvals the vault has paid or registered, by nonce. */
  approvalsUsed: number[];
  /** The pending deposits refunded, by `deposit_id`. */
  refunded: number[];
  /** What is registered and unpaid for the account, in USDC base units. */
  exitClaim: bigint;
  exitDistributionClaim: bigint;
  /** What the vault has already paid of the account's distributions, in USDC base units. */
  distributionPaid: bigint;
  /** The account's deposits the exit root does not hold and the vault has not refunded: no proof is needed for these. */
  unheld: { id: number; amount: bigint }[];
  /** False when the vault holds more deposits than one read goes through, so `unheld` may not be all of them. */
  unheldComplete: boolean;
}

/** What the vault's verifier says of a proof; a refusal is an outcome, and a rejected promise is a read that failed. */
export type ExitCheck =
  /** Every leaf proves against the root, but for the approvals the vault shows paid, which no claim can use now and which `paidApprovals` names. `accountClaim` and `distributionOwed` are USDC base units. */
  | { ok: true; paidApprovals: number[]; accountClaim: bigint; distributionOwed: bigint }
  | { ok: false; reason: string };

/** One transaction of the exit, in the order the vault takes them. */
export type ExitStep =
  | { kind: "start"; terms: ExitTermsProof }
  | { kind: "account"; proof: ExitAccountProof; amount: bigint }
  | { kind: "approval"; proof: ExitApprovalProof; amount: bigint }
  | { kind: "queued"; proof: ExitQueuedProof; amount: bigint }
  | { kind: "distribution"; proof: ExitDistributionProof; amount: bigint }
  | { kind: "refund"; proof: ExitPendingProof; amount: bigint }
  /** A deposit the exit root does not hold, which the vault refunds by its id alone. */
  | { kind: "refund-unheld"; id: number; amount: bigint }
  | { kind: "claim" };

/**
 * A wallet's part in the exit. Everything goes through the wallet's own provider, so none of it needs
 * the node. Reads answer one call at a time and are refused when the wallet sits on another chain.
 * Error cases (every method):
 * - the wallet is on another chain, or a read fails or does not answer in time
 * - `send`: the user declines, or the transaction reverts or is not confirmed
 */
export interface ExitWallet {
  facts(): Promise<VaultExitFacts>;
  /** Checks every leaf of `proof` with the vault's deployed `ExitVerifier`, against `root`. */
  check(proof: ExitProof, root: string): Promise<ExitCheck>;
  /** What the vault holds for the account, and for each part of `proof` when one is given: a claim can be paid, and a deposit the root does not hold refunded, with no proof. */
  claims(proof: ExitProof | null): Promise<ExitClaimFacts>;
  /** Whether the account has MONKEY staked or unstaking, which may earn it a distribution no account read shows. */
  stakeHeld(): Promise<boolean>;
  /** Sends one step and resolves with its transaction hash; for `claim`, the USDC base units the vault paid too. */
  send(step: ExitStep, progress?: Progress): Promise<{ hash: string; paid: bigint | null }>;
}
