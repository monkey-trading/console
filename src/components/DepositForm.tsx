"use client";

/** Deposit to the vault. */

import { useId, useState } from "react";

import { maySign } from "@/lib/engine/attestation";
import { deposit, parseAmount } from "@/lib/store/actions";
import { isWholeUsdc, MAX_DEPOSIT, MIN_DEPOSIT } from "@/lib/vault";

import { useConsole, useSession } from "./ConsoleProvider";

const INPUT = "mt-1 min-h-11 w-full rounded border border-edge bg-ink px-2 py-2 text-base text-fg lg:min-h-0 lg:text-data focus-visible:outline-2 focus-visible:outline-glow";
const SUBMIT = "mt-4 min-h-11 rounded border border-glow bg-glow/10 px-4 py-2.5 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";

/** Deposits come from the wallet to the vault; the node credits them once final. */
export function DepositForm() {
  const { wallet, eligibility, busy, attestation, stream } = useConsole();
  const { store } = useSession();
  const [amount, setAmount] = useState("1000");
  const id = useId();
  const value = parseAmount(amount);
  const valid = value !== null && value >= MIN_DEPOSIT && value <= MAX_DEPOSIT && isWholeUsdc(value);
  return (
    <section aria-labelledby="deposit-title" className="rounded-xl border border-line-2 bg-ink-1 p-5">
      <h2 id="deposit-title" className="text-label tracking-caps text-fg-3 uppercase">2 · Deposit USDC</h2>
      <form onSubmit={(event) => { event.preventDefault(); if (valid && value && !busy && wallet && eligibility !== null && maySign(attestation, stream)) void deposit(store, value); }}>
        <label htmlFor={id} className="mt-4 block text-caption text-fg-2">Amount (USDC)</label>
        <input id={id} value={amount} inputMode="decimal" maxLength={24} onChange={(event) => setAmount(event.target.value)} aria-describedby={`${id}-hint`} className={INPUT} />
        <p id={`${id}-hint`} className="mt-1 text-label leading-relaxed text-fg-3">10 to 1,000,000,000 USDC. The node counts a deposit as collateral at once and releases it for withdrawal when it is final.</p>
        <button type="submit" aria-disabled={!wallet || eligibility === null || !valid || busy || !maySign(attestation, stream)} className={SUBMIT}>Deposit</button>
        {!wallet && <p className="mt-2 text-label text-fg-3">Connect a wallet first.</p>}
        {wallet && eligibility === null && <p className="mt-2 text-label text-fg-3">Sign the eligibility declaration first.</p>}
        {wallet && amount.trim() !== "" && !valid && <p className="mt-2 text-label text-ember">Enter an amount from 10 to 1,000,000,000 USDC, to at most six decimal places.</p>}
      </form>
    </section>
  );
}

