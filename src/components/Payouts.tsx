"use client";

/** The account's approved withdrawals and their claims on the vault: claim, find a missed authorization, or ask for a fresh one. */

import { useEffect, useRef } from "react";

import { formatFixedPlaces } from "@/lib/fixed";
import { checkPaid, claim, findAuthorization, loadApprovals, payoutsOf, reissue, type Payout } from "@/lib/store/payouts";
import { formatStamp } from "@/lib/time";

import { useConsole, useSession } from "./ConsoleProvider";

const BUTTON = "mt-3 min-h-11 w-full rounded border border-glow bg-glow/10 px-3 py-2 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";

/** The claims section of the funding drawer, for a live node. */
export function Payouts() {
  const state = useConsole();
  const { store } = useSession();
  const heading = useRef<HTMLHeadingElement>(null);
  const payouts = payoutsOf(state);
  const address = state.wallet?.address;
  // A new approval reaches the recent history first; it prompts a fresh read of every approval.
  const latest = state.history.find((e) => e.type === "withdrawal_approved")?.cursor ?? "";
  const unpaid = payouts.filter((p) => p.status.kind !== "paid").map((p) => p.nonce).join(",");
  useEffect(() => {
    if (address !== undefined) void loadApprovals(store);
  }, [store, address, latest]);
  useEffect(() => {
    // The vault's own record says which payouts it has paid, including claims made elsewhere.
    if (unpaid !== "") void checkPaid(store);
  }, [store, unpaid]);
  // An action replaces or settles the row's button, so focus returns to the section's heading.
  const act = (run: () => Promise<void>) => {
    if (state.busy) return;
    void run().then(() => heading.current?.focus());
  };
  return (
    <section aria-labelledby="payouts-title" className="rounded-xl border border-line-2 bg-ink-1 p-5">
      <h2 ref={heading} id="payouts-title" tabIndex={-1} className="text-label tracking-caps text-fg-3 uppercase outline-none">Claims on the vault</h2>
      {payouts.length === 0 ? (
        <p className="mt-4 text-caption text-fg-3">{state.wallet ? "No approved withdrawals yet." : "Connect a wallet to see your withdrawals."}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {payouts.map((payout) => <PayoutRow key={payout.nonce} payout={payout} busy={state.busy} act={act} />)}
        </ul>
      )}
    </section>
  );
}

/** One approved withdrawal and the action its status allows; `act` runs it unless one is in flight. */
function PayoutRow({ payout, busy, act }: { payout: Payout; busy: boolean; act: (run: () => Promise<void>) => void }) {
  const { store } = useSession();
  const amount = `${formatFixedPlaces(payout.amount, 2)} USDC`;
  const { status } = payout;
  return (
    <li className="rounded border border-line-2 px-3 py-3 text-caption">
      <p className="flex justify-between gap-2"><span className="text-fg">Withdrawal {payout.nonce}</span><span className="text-fg-2">{amount}</span></p>
      {status.kind === "paid" && <p className="mt-2 text-glow">Paid to your wallet.</p>}
      {status.kind === "claimable" && (
        <>
          <p className="mt-2 text-fg-3">Authorized until {formatStamp(status.expiresAt * 1000)} UTC.</p>
          <button type="button" aria-disabled={busy} onClick={() => act(() => claim(store, payout.nonce))} className={BUTTON}>Claim {amount} on the vault</button>
        </>
      )}
      {status.kind === "expired" && (
        <>
          <p className="mt-2 text-fg-3">Its authorization expired unclaimed at {formatStamp(status.expiresAt * 1000)} UTC.</p>
          <button type="button" aria-disabled={busy} onClick={() => act(() => reissue(store, payout.nonce, status.expiresAt))} className={BUTTON}>Ask for a new authorization</button>
        </>
      )}
      {status.kind === "waiting" && (
        <>
          <p className="mt-2 text-fg-3">Waiting for its authorization, which the node signs once a checkpoint covering the approval is confirmed on chain.</p>
          <button type="button" aria-disabled={busy} onClick={() => act(() => findAuthorization(store, payout.nonce, payout.approvedSeq))} className={BUTTON}>Look for it in the log</button>
        </>
      )}
    </li>
  );
}
