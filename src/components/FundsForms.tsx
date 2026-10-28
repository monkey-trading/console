"use client";

/** Deposit to the vault and withdraw from it. */

import { useId, useState } from "react";

import { maySign } from "@/lib/engine/attestation";
import { formatFixedPlaces, maxFixed, minFixed, type Fixed } from "@/lib/fixed";
import { deposit, parseAmount, withdraw } from "@/lib/store/actions";
import { MAX_DEPOSIT, MIN_DEPOSIT } from "@/lib/mock/funds";

import { useConsole, useSession } from "./ConsoleProvider";

const INPUT = "mt-1 w-full rounded border border-line-2 bg-ink px-2 py-2 text-data text-fg focus-visible:outline-2 focus-visible:outline-glow";
const SUBMIT = "mt-4 rounded border border-glow bg-glow/10 px-4 py-2.5 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow disabled:cursor-not-allowed disabled:border-line-2 disabled:bg-transparent disabled:text-fg-3";

/** Deposits come from the wallet to the vault; the node credits them once final. */
export function DepositForm() {
  const { wallet, eligibility, busy } = useConsole();
  const { store } = useSession();
  const [amount, setAmount] = useState("1000");
  const id = useId();
  const value = parseAmount(amount);
  const valid = value !== null && value >= MIN_DEPOSIT && value <= MAX_DEPOSIT;
  return (
    <section aria-labelledby="deposit-title" className="rounded-xl border border-line-2 bg-ink-1 p-5">
      <h2 id="deposit-title" className="text-label tracking-caps text-fg-3 uppercase">2 · Deposit USDC</h2>
      <form onSubmit={(event) => { event.preventDefault(); if (valid && value) void deposit(store, value); }}>
        <label htmlFor={id} className="mt-4 block text-caption text-fg-2">Amount (USDC)</label>
        <input id={id} value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} aria-describedby={`${id}-hint`} className={INPUT} />
        <p id={`${id}-hint`} className="mt-1 text-label leading-relaxed text-fg-3">10 to 1,000,000,000 USDC. The vault records your wallet as the payer and the node credits your account once the deposit is final.</p>
        <button type="submit" disabled={!wallet || eligibility === null || !valid || busy} className={SUBMIT}>Deposit</button>
        {!wallet && <p className="mt-2 text-label text-fg-3">Connect a wallet first.</p>}
        {wallet && eligibility === null && <p className="mt-2 text-label text-fg-3">Sign the eligibility declaration first.</p>}
        {wallet && amount.trim() !== "" && !valid && <p className="mt-2 text-label text-alarm">Enter an amount from 10 to 1,000,000,000.</p>}
      </form>
    </section>
  );
}

/** What the account can withdraw now: equity above margin, never more than its cash. */
export function withdrawableNow(balance: Fixed, equity: Fixed, margin: Fixed): Fixed {
  return maxFixed(0n, minFixed(balance, equity - margin));
}

/** Withdrawals are reserved first in, first out, and paid in whole USDC as the vault has liquidity. */
export function WithdrawForm() {
  const { wallet, account, attestation, busy } = useConsole();
  const { store } = useSession();
  const [amount, setAmount] = useState("");
  const id = useId();
  const max = account ? withdrawableNow(account.balance, account.equity, account.margin) : 0n;
  const value = parseAmount(amount);
  const valid = value !== null && value <= max;
  return (
    <section aria-labelledby="withdraw-title" className="rounded-xl border border-line-2 bg-ink-1 p-5">
      <h2 id="withdraw-title" className="text-label tracking-caps text-fg-3 uppercase">3 · Withdraw</h2>
      <form onSubmit={(event) => { event.preventDefault(); if (valid && value) void withdraw(store, value).then(() => setAmount("")); }}>
        <label htmlFor={id} className="mt-4 flex justify-between text-caption text-fg-2">Amount (USDC)
          <button type="button" onClick={() => setAmount(formatFixedPlaces(max, 2).replaceAll(",", ""))} className="text-glow underline focus-visible:outline-2 focus-visible:outline-glow">Max ${formatFixedPlaces(max, 2)}</button>
        </label>
        <input id={id} value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} className={INPUT} />
        <p className="mt-1 text-label leading-relaxed text-fg-3">The amount leaves your balance when you ask. The vault pays requests in order, in whole USDC, as it has liquidity; the rest waits in the queue below.</p>
        <button type="submit" disabled={!wallet || !valid || busy || !maySign(attestation)} className={SUBMIT}>Request withdrawal</button>
        {value !== null && value > max && <p className="mt-2 text-label text-alarm">You can withdraw up to ${formatFixedPlaces(max, 2)} while your positions use margin.</p>}
      </form>
    </section>
  );
}

