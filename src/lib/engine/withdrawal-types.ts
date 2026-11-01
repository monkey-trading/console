/** The withdrawal wire shapes: the public FIFO queue's pages and the signed payouts the stream carries. */

import type { Address } from "./types";

export interface QueuedWithdrawal {
  position: number;
  account: Address;
  amount: string;
  remaining: string;
  requested_seq: number;
}

/** `GET /v1/withdrawals`, and `GET /v1/accounts/{address}/withdrawals` filtered to one account. */
export interface WithdrawalPage {
  seq: number | null;
  queue: QueuedWithdrawal[];
  next: number | null;
}

/** The vault's EIP-712 authorization of an approved payout, with its proof against a checkpoint root. */
export interface WithdrawalAuthorization {
  signer: Address;
  signer_epoch: number;
  /** Unix seconds; the vault accepts it until `expires_at`, 24 hours later. */
  issued_at: number;
  expires_at: number;
  checkpoint_seq: number;
  checkpoint_root: string;
  siblings: string[];
}

/** A signed withdrawal as the stream carries it (`type: "withdrawal"`): what the account claims on the vault. */
export interface SignedWithdrawal {
  account: Address;
  amount: string;
  /** The payout nonce `withdrawal_approved` named. */
  nonce: number;
  chain_id: number;
  vault: Address;
  signature: string;
  approved_seq?: number;
  authorization?: WithdrawalAuthorization;
}
