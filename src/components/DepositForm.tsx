"use client";

/** Deposit to the vault. */

import { useId, useState } from "react";

import { deposit, parseAmount } from "@/lib/store/actions";
import { isWholeUsdc, MAX_DEPOSIT, MIN_DEPOSIT } from "@/lib/vault";

import { useConsole, useSession } from "./ConsoleProvider";
import { useSignGate } from "./SignGate";

const INPUT = "mt-1 min-h-11 w-full rounded border border-edge bg-ink px-2 py-2 text-base text-fg lg:min-h-0 lg:text-data focus-visible:outline-2 focus-visible:outline-glow";
const SUBMIT = "mt-4 min-h-11 rounded border border-glow bg-glow/10 px-4 py-2.5 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";

/** Deposits come from the wallet to the vault; the node credits them once final. `step` is the section's place in the drawer. */
export function DepositForm({ step }: { step: number }) {
  const { wallet, eligibility, busy, signatures } = useConsole();
  const { store } = useSession();
  const [amount, setAmount] = useState("1000");
  const id = useId();
  const gate = useSignGate(`${id}-gate`);
  const value = parseAmount(amount);
  const valid = value !== null && value >= MIN_DEPOSIT && value <= MAX_DEPOSIT && isWholeUsdc(value);
  // The engine takes a never-credited account's declaration only once a deposit is pending; the mock asks for it first.
  const declareFirst = signatures === "none" && eligibility === null;
  return (
    <section aria-labelledby="deposit-title" className="rounded-xl border border-line-2 bg-ink-1 p-5">
      <h2 id="deposit-title" className="text-label tracking-caps text-fg-3 uppercase">{step} · Deposit USDC</h2>
      <form onSubmit={(event) => { event.preventDefault(); if (valid && value && !busy && wallet && !declareFirst && !gate.blocked) void deposit(store, value); }}>
        <label htmlFor={id} className="mt-4 block text-caption text-fg-2">Amount (USDC)</label>
        <input id={id} value={amount} inputMode="decimal" maxLength={24} onChange={(event) => setAmount(event.target.value)} aria-describedby={`${id}-hint`} className={INPUT} />
        <p id={`${id}-hint`} className="mt-1 text-label leading-relaxed text-fg-3">10 to 1,000,000,000 USDC. Your wallet approves the vault for the amount, if it needs to, then deposits it. The node counts a deposit as collateral once it is credited and releases it for withdrawal when it is final.</p>
        <button type="submit" aria-disabled={!wallet || declareFirst || !valid || busy || gate.blocked} aria-describedby={gate.describedBy} className={SUBMIT}>Deposit</button>
        {gate.note}
        {!wallet && <p className="mt-2 text-label text-fg-3">Connect a wallet first.</p>}
        {wallet && declareFirst && <p className="mt-2 text-label text-fg-3">Sign the eligibility declaration first.</p>}
        {wallet && amount.trim() !== "" && !valid && <p className="mt-2 text-label text-ember">Enter an amount from 10 to 1,000,000,000 USDC, to at most six decimal places.</p>}
      </form>
    </section>
  );
}

