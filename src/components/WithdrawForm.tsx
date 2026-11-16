"use client";

/** Withdraw from the vault. */

import { useId, useState } from "react";

import { withdrawableOf, withdrawCause } from "@/lib/account-figures";
import { formatFixedPlaces } from "@/lib/fixed";
import { parseAmount, withdraw } from "@/lib/store/actions";
import { MIN_WITHDRAWAL } from "@/lib/vault";

import { AMOUNT_INPUT } from "./amount-input";
import { useConsole, useSession } from "./ConsoleProvider";
import { Notice } from "./Notice";
import { useSignGate } from "./SignGate";

const INPUT = "min-h-11 w-full min-w-0 rounded border border-edge bg-ink px-2 py-2 text-base text-fg lg:min-h-0 lg:text-data focus-visible:outline-2 focus-visible:outline-glow";
const SUBMIT = "min-h-11 shrink-0 rounded border border-glow bg-glow/10 px-4 py-2.5 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";

/** Withdrawals are reserved first in, first out, and paid in whole USDC as the vault has liquidity. */
export function WithdrawForm() {
  const { wallet, account, busy } = useConsole();
  const { store } = useSession();
  const [amount, setAmount] = useState("");
  const id = useId();
  const gate = useSignGate(`${id}-gate`);
  const max = account ? withdrawableOf(account) : 0n;
  const cause = account ? withdrawCause(account) : null;
  const value = parseAmount(amount);
  const valid = value !== null && value >= MIN_WITHDRAWAL && value <= max;
  return (
    <section aria-labelledby="withdraw-title" className="p-4">
      <h4 id="withdraw-title" className="text-label tracking-caps text-fg-3 uppercase">Withdraw USDC</h4>
      <form onSubmit={(event) => { event.preventDefault(); if (valid && value && wallet && !busy && !gate.blocked) void withdraw(store, value).then((taken) => taken && setAmount("")); }}>
        <div className="mt-3 flex items-center justify-between text-caption text-fg-2">
          <label htmlFor={id}>Amount (USDC)</label>
          <button type="button" onClick={() => setAmount(formatFixedPlaces(max, 6).replaceAll(",", "").replace(/\.?0+$/, ""))} className="inline-flex min-h-11 items-center text-glow underline focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0">Max ${formatFixedPlaces(max, 2)}</button>
        </div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input {...AMOUNT_INPUT} id={id} value={amount} inputMode="decimal" maxLength={24} onChange={(event) => setAmount(event.target.value)} className={INPUT} />
          <button type="submit" aria-disabled={!wallet || !valid || busy || gate.blocked} aria-describedby={gate.describedBy} className={SUBMIT}>Request withdrawal</button>
        </div>
        <p className="mt-2 text-label leading-relaxed text-fg-3">The amount is deducted from your balance as soon as you request the withdrawal. Withdrawals are paid in the order they were requested as funds become available, and any amount that cannot be paid immediately waits in the withdrawal queue.</p>
        {gate.note}
        <Notice surface="withdraw" />
        {account && account.unfinalised > 0n && <p className="mt-2 text-label text-fg-3">${formatFixedPlaces(account.unfinalised, 2)} of your balance cannot be withdrawn until the deposit that funded it is final on chain.</p>}
        {amount.trim() !== "" && value === null && <p className="mt-2 text-label text-ember">Enter the amount in digits, using a decimal point if needed, for example 1250.50.</p>}
        {value !== null && value < MIN_WITHDRAWAL && <p className="mt-2 text-label text-ember">The minimum withdrawal is 10 USDC.</p>}
        {value !== null && value > max && <p className="mt-2 text-label text-ember">You can withdraw at most ${formatFixedPlaces(max, 2)}{cause === "margin" ? " while your open positions require margin." : cause === "unfinal" ? " until your latest deposit is final on chain." : "."}</p>}
      </form>
    </section>
  );
}

