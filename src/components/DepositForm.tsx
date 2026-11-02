"use client";

/** Deposit to the vault, beside the USDC the wallet holds on the custody chain. */

import { useId, useState } from "react";

import { chainName } from "@/lib/engine/chains";
import { formatFixedPlaces } from "@/lib/fixed";
import { deposit, parseAmount } from "@/lib/store/actions";
import { readWalletUsdc } from "@/lib/store/wallet-usdc";
import { isWholeUsdc, MAX_DEPOSIT, MIN_DEPOSIT, plainUsdc } from "@/lib/vault";

import { useConsole, useSession } from "./ConsoleProvider";
import { useSignGate } from "./SignGate";
import { useWalletUsdc } from "./useWalletUsdc";

const INPUT = "min-h-11 w-full min-w-0 rounded border border-edge bg-ink px-2 py-2 text-base text-fg lg:min-h-0 lg:text-data focus-visible:outline-2 focus-visible:outline-glow";
const SUBMIT = "min-h-11 shrink-0 rounded border border-glow bg-glow/10 px-4 py-2.5 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";
const LINK = "min-h-6 rounded border border-line-2 px-2 text-label text-glow hover:border-glow focus-visible:outline-2 focus-visible:outline-glow";

/** Deposits come from the wallet to the vault; the node credits them once final. `embedded` drops the title and padding, for the setup popup's step, which has its own. */
export function DepositForm({ embedded = false }: { embedded?: boolean }) {
  const { wallet, busy, walletUsdc } = useConsole();
  const { store, deploy } = useSession();
  const [amount, setAmount] = useState("1000");
  const id = useId();
  const gate = useSignGate(`${id}-gate`);
  useWalletUsdc();
  const value = parseAmount(amount);
  const held = walletUsdc.read.status === "held" ? walletUsdc.read.amount : null;
  const over = value !== null && held !== null && value > held;
  const valid = value !== null && value >= MIN_DEPOSIT && value <= MAX_DEPOSIT && isWholeUsdc(value) && !over;
  const chain = chainName(deploy.chainId);
  const watching = wallet === null || wallet.readOnly === true;
  const title = embedded ? null : <h4 id={`${id}-title`} className="text-label tracking-caps text-fg-3 uppercase">Deposit USDC</h4>;
  return (
    <section aria-labelledby={embedded ? undefined : `${id}-title`} className={embedded ? "mt-3" : "p-4"}>
      {title}
      {!watching && (
        <p className={`${embedded ? "" : "mt-3 "}flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-2`}>
          {walletUsdc.read.status === "unread" && "Reading your wallet's USDC…"}
          {held !== null && <>
            <span>Wallet: <span className="text-fg">{formatFixedPlaces(held, 2)} USDC</span> on {chain}</span>
            <button type="button" onClick={() => setAmount(plainUsdc(held))} className={LINK}>Max</button>
          </>}
          {walletUsdc.read.status === "wrong_chain" && `Your wallet is on ${chainName(walletUsdc.read.chainId)}. Switch it to ${chain} to see its USDC.`}
          {walletUsdc.read.status === "failed" && <>
            <span>Your wallet&apos;s USDC could not be read.</span>
            <button type="button" onClick={() => void readWalletUsdc(store, true)} className={LINK}>Try again</button>
          </>}
        </p>
      )}
      <form onSubmit={(event) => { event.preventDefault(); if (valid && value && !busy && wallet && !gate.blocked) void deposit(store, value); }}>
        <label htmlFor={id} className="mt-3 block text-caption text-fg-2">Amount (USDC)</label>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input id={id} value={amount} inputMode="decimal" maxLength={24} onChange={(event) => setAmount(event.target.value)} aria-describedby={`${id}-hint`} className={INPUT} />
          <button type="submit" aria-disabled={!wallet || !valid || busy || gate.blocked} aria-describedby={gate.describedBy} className={SUBMIT}>Deposit</button>
        </div>
        <p id={`${id}-hint`} className="mt-2 text-label leading-relaxed text-fg-3">10 to 1,000,000,000 USDC. Your wallet approves the vault for the amount, if it needs to, then deposits it. The node counts a deposit as collateral once it is credited and releases it for withdrawal when it is final.</p>
        {gate.note}
        {!wallet && <p className="mt-2 text-label text-fg-3">Connect a wallet first.</p>}
        {wallet && over && held !== null && <p className="mt-2 text-label text-ember">That is more than the {formatFixedPlaces(held, 2)} USDC your wallet holds on {chain}.</p>}
        {wallet && !over && amount.trim() !== "" && !valid && <p className="mt-2 text-label text-ember">Enter an amount from 10 to 1,000,000,000 USDC, to at most six decimal places.</p>}
      </form>
    </section>
  );
}
