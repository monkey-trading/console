"use client";

/** Withdraw from the vault. */

import { useId, useState } from "react";

import { maySign } from "@/lib/engine/attestation";
import { formatFixedPlaces } from "@/lib/fixed";
import { parseAmount, withdraw } from "@/lib/store/actions";
import { MIN_WITHDRAWAL, withdrawableNow } from "@/lib/vault";

import { useConsole, useSession } from "./ConsoleProvider";

const INPUT = "mt-1 min-h-11 w-full rounded border border-edge bg-ink px-2 py-2 text-base text-fg lg:min-h-0 lg:text-data focus-visible:outline-2 focus-visible:outline-glow";
const SUBMIT = "mt-4 min-h-11 rounded border border-glow bg-glow/10 px-4 py-2.5 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";

/** Withdrawals are reserved first in, first out, and paid in whole USDC as the vault has liquidity. */
export function WithdrawForm() {
  const { wallet, account, attestation, stream, busy } = useConsole();
  const { store } = useSession();
  const [amount, setAmount] = useState("");
  const id = useId();
  const max = account ? withdrawableNow(account.balance, account.equity, account.margin, account.unfinalised) : 0n;
  const value = parseAmount(amount);
  const valid = value !== null && value >= MIN_WITHDRAWAL && value <= max;
  return (
    <section aria-labelledby="withdraw-title" className="rounded-xl border border-line-2 bg-ink-1 p-5">
      <h2 id="withdraw-title" className="text-label tracking-caps text-fg-3 uppercase">3 · Withdraw</h2>
      <form onSubmit={(event) => { event.preventDefault(); if (valid && value && wallet && !busy && maySign(attestation, stream)) void withdraw(store, value).then((taken) => taken && setAmount("")); }}>
        <div className="mt-4 flex items-center justify-between text-caption text-fg-2">
          <label htmlFor={id}>Amount (USDC)</label>
          <button type="button" onClick={() => setAmount(formatFixedPlaces(max, 6).replaceAll(",", "").replace(/\.?0+$/, ""))} className="inline-flex min-h-11 items-center text-glow underline focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0">Max ${formatFixedPlaces(max, 2)}</button>
        </div>
        <input id={id} value={amount} inputMode="decimal" maxLength={24} onChange={(event) => setAmount(event.target.value)} className={INPUT} />
        <p className="mt-1 text-label leading-relaxed text-fg-3">The amount leaves your balance when you ask. The vault pays requests in order as it has liquidity, to six decimal places; the rest waits in the queue below.</p>
        <button type="submit" aria-disabled={!wallet || !valid || busy || !maySign(attestation, stream)} className={SUBMIT}>Request withdrawal</button>
        {amount.trim() !== "" && value === null && <p className="mt-2 text-label text-ember">Enter the amount in digits with a decimal point if needed, such as 1250.50.</p>}
        {value !== null && value < MIN_WITHDRAWAL && <p className="mt-2 text-label text-ember">The smallest withdrawal is 10 USDC.</p>}
        {value !== null && value > max && <p className="mt-2 text-label text-ember">You can withdraw up to ${formatFixedPlaces(max, 2)} while your positions use margin.</p>}
      </form>
    </section>
  );
}

