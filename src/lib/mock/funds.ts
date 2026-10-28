/** Deposits through the vault, withdrawals reserved first-in first-out, and the vault's liquidity. */

import { EngineError, type ActionResult } from "../engine/client";
import type { EngineEvent, QueuedWithdrawal, WithdrawalPage, WithdrawalRequest } from "../engine/types";
import { fixedToWire, minFixed, parseFixed, type Fixed } from "../fixed";
import { equityOf, marginOf } from "./accounts";
import { MAX_DEPOSIT, MIN_DEPOSIT, USDC_UNIT, withdrawableNow } from "../vault";
import { checkAccess, checkAuth } from "./orders";
import { FINALITY_MS, type MockState } from "./state";

/** Rounds toward zero to whole USDC base units, as the engine does; the dust stays in account cash. */
const wholeUsdc = (value: Fixed): Fixed => (value / USDC_UNIT) * USDC_UNIT;

/**
 * A deposit the wallet sent to the vault. As the node does, it counts as collateral at once, with
 * a withdrawal lock until it is final.
 * Error cases:
 * - the account has not attested eligibility (403), or the amount is outside the vault's bounds or finer than a USDC base unit (400)
 * The caller's region is not checked: the vault screens the paying address, not the connection.
 */
export function chainDeposit(state: MockState, address: string, amount: Fixed): void {
  const account = state.account(address);
  if (account.eligibility === null) throw new EngineError(403, "eligibility attestation required", { type: "access", reason: "eligibility_required" });
  if (amount < MIN_DEPOSIT || amount > MAX_DEPOSIT) throw new EngineError(400, "deposits are 10 to 1,000,000,000 USDC");
  if (amount !== wholeUsdc(amount)) throw new EngineError(400, "USDC has six decimal places");
  account.pending.push({ amount, readyAt: state.now + FINALITY_MS });
  account.balance += amount;
  state.emit({ type: "deposit" }, [{ type: "deposited", account: address, amount: fixedToWire(amount) }]);
}

/** Releases the withdrawal lock on every deposit whose finality time has passed; the balance already holds it. */
export function creditFinal(state: MockState): EngineEvent[] {
  for (const account of state.accounts.values()) account.pending = account.pending.filter((deposit) => deposit.readyAt > state.now);
  return [];
}

/** What an account may withdraw now; see `withdrawableNow`. */
export function withdrawable(state: MockState, address: string): Fixed {
  const account = state.account(address);
  const locked = account.pending.reduce((sum, deposit) => sum + deposit.amount, 0n);
  return withdrawableNow(account.balance, equityOf(state, account), marginOf(state, account), locked);
}

/**
 * Sequences a withdrawal. The amount leaves the balance at once; the vault approves what its
 * liquidity covers in whole USDC base units, and only when no earlier request waits; the rest queues.
 * Error cases (as HTTP errors):
 * - the region is refused (403) or the request's signature fields are wrong (see `checkAuth`)
 */
export function withdraw(state: MockState, req: WithdrawalRequest): ActionResult {
  checkAccess(state);
  const account = state.account(req.account);
  checkAuth(state, account, req.auth);
  const requested = parseFixed(req.amount);
  // The engine reserves whole USDC base units; any finer dust of the request stays in account cash.
  const amount = requested === null ? null : wholeUsdc(requested);
  const events: EngineEvent[] = [];
  if (amount === null || amount <= 0n) {
    events.push({ type: "withdrawal_rejected", account: req.account, amount: req.amount, reason: { type: "invalid_amount" } });
  } else if (amount > withdrawable(state, req.account)) {
    const available = fixedToWire(withdrawable(state, req.account));
    events.push({ type: "withdrawal_rejected", account: req.account, amount: req.amount, reason: { type: "insufficient_funds", available } });
  } else {
    account.balance -= amount;
    const approved = state.queue.some((entry) => entry.remaining > 0n) ? 0n : wholeUsdc(minFixed(amount, state.vaultLiquidity));
    if (approved > 0n) {
      state.vaultLiquidity -= approved;
      events.push({ type: "withdrawal_approved", account: req.account, amount: fixedToWire(approved), nonce: state.seq + 1 });
    }
    if (approved < amount) {
      state.queue.push({ account: req.account.toLowerCase(), amount, remaining: amount - approved, requestedSeq: state.seq + 1 });
      events.push({ type: "withdrawal_queued", account: req.account, amount: fixedToWire(amount - approved), requested_seq: state.seq + 1 });
    }
  }
  return { seq: state.emit({ type: "withdraw" }, events).seq, events };
}

/** Adds liquidity to the vault and approves the queue's heads, in order, in whole USDC base units. */
export function payQueue(state: MockState, added: Fixed): EngineEvent[] {
  state.vaultLiquidity += added;
  const events: EngineEvent[] = [];
  for (const entry of state.queue) {
    if (entry.remaining <= 0n) continue;
    const pay = wholeUsdc(minFixed(entry.remaining, state.vaultLiquidity));
    if (pay <= 0n) break; // first in, first out: a later request never jumps the head
    state.vaultLiquidity -= pay;
    entry.remaining -= pay;
    events.push({ type: "withdrawal_approved", account: entry.account, amount: fixedToWire(pay), nonce: state.seq + 1 + events.length });
    events.push({ type: "withdrawal_queue_updated", account: entry.account, requested_seq: entry.requestedSeq, remaining: fixedToWire(entry.remaining) });
  }
  for (let i = state.queue.length - 1; i >= 0; i--) if ((state.queue[i]?.remaining ?? 0n) <= 0n) state.queue.splice(i, 1);
  return events;
}

/** The account's queued requests with their one-based positions in the whole FIFO. */
export function queuePage(state: MockState, address: string): WithdrawalPage {
  const key = address.toLowerCase();
  const queue: QueuedWithdrawal[] = [];
  state.queue.forEach((entry, index) => {
    if (entry.account === key) {
      queue.push({ position: index + 1, account: entry.account, amount: fixedToWire(entry.amount), remaining: fixedToWire(entry.remaining), requested_seq: entry.requestedSeq });
    }
  });
  return { seq: state.seq, queue, next: null };
}
