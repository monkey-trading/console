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
    if (state.busy || state.searching !== null) return;
    void run().then(() => heading.current?.focus());
  };
  const idle = !state.busy && state.searching === null;
  return (
    <section aria-labelledby="payouts-title" className="rounded-xl border border-line-2 bg-ink-1 p-5">
      <h2 ref={heading} id="payouts-title" tabIndex={-1} className="text-label tracking-caps text-fg-3 uppercase outline-none">Claims on the vault</h2>
      {payouts.length === 0 ? (
        <p className="mt-4 text-caption text-fg-3">{state.wallet ? "No approved withdrawals yet." : "Connect a wallet to see your withdrawals."}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {payouts.map((payout) => <PayoutRow key={payout.nonce} payout={payout} idle={idle} searching={state.searching === payout.nonce} act={act} />)}
        </ul>
      )}
      {state.approvalsNext !== null && (
        <button type="button" aria-disabled={!idle} onClick={() => act(() => loadApprovals(store, true))} className={BUTTON}>Load older withdrawals</button>
      )}
    </section>
  );
}

/** One approved withdrawal and the actions its status allows; `act` runs one unless another is in flight. */
function PayoutRow({ payout, idle, searching, act }: { payout: Payout; idle: boolean; searching: boolean; act: (run: () => Promise<void>) => void }) {
  const { store } = useSession();
  const amount = `${formatFixedPlaces(payout.amount, 2)} USDC`;
  const { status, nonce, searchFrom } = payout;
  const search = (label: string) => (
    <button type="button" aria-disabled={!idle} onClick={() => act(() => findAuthorization(store, nonce, searchFrom))} className={BUTTON}>{searching ? "Searching the log…" : label}</button>
  );
  return (
    <li className="rounded border border-line-2 px-3 py-3 text-caption">
      <p className="flex justify-between gap-2"><span className="text-fg">Withdrawal {nonce}</span><span className="text-fg-2">{amount}</span></p>
      {status.kind === "paid" && <p className="mt-2 text-glow">Paid to your wallet.</p>}
      {status.kind === "claimable" && (
        <>
          <p className="mt-2 text-fg-3">Authorized until {formatStamp(status.expiresAt * 1000)} UTC.</p>
          <button type="button" aria-disabled={!idle} onClick={() => act(() => claim(store, nonce))} className={BUTTON}>Claim {amount} on the vault</button>
          {search("Look for a newer authorization in the log")}
        </>
      )}
      {status.kind === "missed" && (
        <>
          <p className="mt-2 text-fg-3">The node signed a newer authorization, valid until {formatStamp(status.expiresAt * 1000)} UTC, which this page has not received.</p>
          {search("Look for it in the log")}
        </>
      )}
      {status.kind === "expired" && (
        <>
          <p className="mt-2 text-fg-3">Its authorization expired unclaimed at {formatStamp(status.expiresAt * 1000)} UTC.</p>
          <button type="button" aria-disabled={!idle} onClick={() => act(() => reissue(store, nonce, status.expiresAt, searchFrom))} className={BUTTON}>Ask for a new authorization</button>
          {search("Look for a newer one in the log")}
        </>
      )}
      {status.kind === "waiting" && (
        <>
          <p className="mt-2 text-fg-3">Waiting for its authorization, which the node signs once a checkpoint covering the approval is confirmed on chain.</p>
          {search("Look for it in the log")}
        </>
      )}
    </li>
  );
}
