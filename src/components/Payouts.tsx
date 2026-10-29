"use client";

/** The account's approved withdrawals and their claims on the vault: claim, find a missed authorization, or ask for a fresh one. */

import { useEffect } from "react";

import { formatFixedPlaces } from "@/lib/fixed";
import { checkPaid, claim, findAuthorization, payoutsOf, reissue, type Payout } from "@/lib/store/payouts";
import { formatStamp } from "@/lib/time";

import { useConsole, useSession } from "./ConsoleProvider";

const BUTTON = "mt-3 min-h-11 w-full rounded border border-glow bg-glow/10 px-3 py-2 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow disabled:cursor-not-allowed disabled:border-line-2 disabled:bg-transparent disabled:text-fg-3 lg:min-h-0";

export function Payouts() {
  const state = useConsole();
  const { store } = useSession();
  const payouts = payoutsOf(state).slice(0, 10);
  const unpaid = payouts.filter((p) => p.status.kind !== "paid").map((p) => p.nonce).join(",");
  useEffect(() => {
    // The vault's own record says which payouts it has paid, including claims made elsewhere.
    if (unpaid !== "") void checkPaid(store);
  }, [store, unpaid]);
  return (
    <section aria-labelledby="payouts-title" className="rounded-xl border border-line-2 bg-ink-1 p-5">
      <h2 id="payouts-title" className="text-label tracking-caps text-fg-3 uppercase">Claims on the vault</h2>
      {payouts.length === 0 ? (
        <p className="mt-4 text-caption text-fg-3">{state.wallet ? "No approved withdrawals yet." : "Connect a wallet to see your withdrawals."}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {payouts.map((payout) => <PayoutRow key={payout.nonce} payout={payout} busy={state.busy} />)}
        </ul>
      )}
    </section>
  );
}

function PayoutRow({ payout, busy }: { payout: Payout; busy: boolean }) {
  const { store } = useSession();
  const amount = `$${formatFixedPlaces(payout.amount, 2)}`;
  const { status } = payout;
  return (
    <li className="rounded border border-line-2 px-3 py-3 text-caption">
      <p className="flex justify-between gap-2"><span className="text-fg">Withdrawal {payout.nonce}</span><span className="text-fg-2">{amount}</span></p>
      {status.kind === "paid" && <p className="mt-2 text-glow">Paid to your wallet.</p>}
      {status.kind === "claimable" && (
        <>
          <p className="mt-2 text-fg-3">Authorized until {formatStamp(status.expiresAt * 1000)} UTC.</p>
          <button type="button" disabled={busy} onClick={() => void claim(store, payout.nonce)} className={BUTTON}>Claim {amount} on the vault</button>
        </>
      )}
      {status.kind === "expired" && (
        <>
          <p className="mt-2 text-fg-3">Its authorization expired unclaimed at {formatStamp(status.expiresAt * 1000)} UTC.</p>
          <button type="button" disabled={busy} onClick={() => void reissue(store, payout.nonce, status.expiresAt)} className={BUTTON}>Ask for a new authorization</button>
        </>
      )}
      {status.kind === "waiting" && (
        <>
          <p className="mt-2 text-fg-3">Waiting for its authorization, which the node signs once a checkpoint covering the approval is confirmed on chain.</p>
          <button type="button" disabled={busy} onClick={() => void findAuthorization(store, payout.nonce, payout.approvedSeq)} className={BUTTON}>Look for it in the log</button>
        </>
      )}
    </li>
  );
}
