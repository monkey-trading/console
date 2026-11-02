/** Tests only: fixtures for the payout tests. */

import vectors from "../engine/eip712-vectors.json";
import type { HistoryEvent, PayoutsPage, SignedWithdrawal } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { VAULT } from "./live-kit";

export const OTHER = "0x00000000000000000000000000000000000000aa";
export const approved = (nonce: number, seq: number): HistoryEvent => ({ type: "withdrawal_approved", account: ACCOUNT, amount: "10", nonce, cursor: `${seq}:0`, ts: 0 });
export const signed = (nonce: number, expiresAt: number): SignedWithdrawal => ({
  account: ACCOUNT, amount: "10", nonce, chain_id: vectors.chain_id, vault: VAULT, signature: `0x${"22".repeat(65)}`, approved_seq: 40,
  authorization: { signer: OTHER, signer_epoch: 1, issued_at: expiresAt - 86_400, expires_at: expiresAt, checkpoint_seq: 64, checkpoint_root: `0x${"33".repeat(32)}`, siblings: [] },
});
/** A node page of unpaid approvals, at seq 100 and loaded unless `extra` says otherwise. */
export const page = (payouts: { nonce: number; withdrawal?: SignedWithdrawal }[], extra: Partial<PayoutsPage> = {}): PayoutsPage => ({ seq: 100, loaded: true, next: null, ...extra, payouts: payouts.map((p) => ({ nonce: p.nonce, amount: "10", withdrawal: p.withdrawal ?? null })) });
