"use client";

/** The account's approved withdrawals and their claims on the vault: claim, find a missed authorization, or ask for a fresh one. */

import { useEffect, useId, useRef } from "react";

import { checkPaid, claim, findAuthorization, loadApprovals, payoutsOf, reissue, unreadPayouts, type Payout } from "@/lib/store/payouts";
import { formatStamp } from "@/lib/time";
import { formatUsdc } from "@/lib/vault";

import { useConsole, useSession } from "./ConsoleProvider";
import { useReadOnlyNote } from "./SignGate";

const BUTTON = "mt-3 min-h-11 w-full rounded border border-glow bg-glow/10 px-3 py-2 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";

/** The claims section of the Funding page's In progress column, for a live node. */
export function Payouts() {
  const state = useConsole();
  const { store } = useSession();
  const heading = useRef<HTMLHeadingElement>(null);
  const readOnly = useReadOnlyNote(useId(), "Claiming and asking for a new authorization");
  const payouts = payoutsOf(state);
  const address = state.wallet?.address;
  // A new approval reaches the recent history first; it prompts a fresh read of every approval.
  const latest = state.history.find((e) => e.type === "withdrawal_approved")?.cursor ?? "";
  const unread = unreadPayouts(state).join(",");
  useEffect(() => {
    if (address !== undefined) void loadApprovals(store);
  }, [store, address, latest]);
  useEffect(() => {
    // The vault's own record says whether it has paid each payout the page can act on, including by a claim made elsewhere before the read.
    if (unread !== "") void checkPaid(store);
  }, [store, unread]);
  // An action replaces or settles the row's button, so focus returns to the section's heading.
  const act = (run: () => Promise<void>) => {
    if (state.busy || state.searching !== null) return;
    void run().then(() => heading.current?.focus());
  };
  const idle = !state.busy && state.searching === null;
  return (
    <section aria-labelledby="payouts-title" className="p-4">
      <h4 ref={heading} id="payouts-title" tabIndex={-1} className="text-label tracking-caps text-fg-3 uppercase outline-none">Claims on the vault</h4>
      {readOnly.note}
      {payouts.length === 0 ? (
        <p className="mt-3 text-caption text-fg-3">{state.wallet ? "No approved withdrawals yet." : "Connect a wallet to see your withdrawals."}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {payouts.map((payout) => <PayoutRow key={payout.nonce} payout={payout} idle={idle} signs={!readOnly.readOnly} describedBy={readOnly.describedBy} searching={state.searching === payout.nonce} act={act} />)}
        </ul>
      )}
      {state.approvalsNext !== null && (
        <button type="button" aria-disabled={!idle} onClick={() => act(() => loadApprovals(store, true))} className={BUTTON}>Load older withdrawals</button>
      )}
    </section>
  );
}

/** One approved withdrawal and the actions its status allows; `act` runs one unless another is in flight. */
function PayoutRow({ payout, idle, signs, describedBy, searching, act }: { payout: Payout; idle: boolean; /** False for a read-only account, which cannot claim or ask for a signature. */ signs: boolean; describedBy: string | undefined; searching: boolean; act: (run: () => Promise<void>) => void }) {
  const { store } = useSession();
  const amount = formatUsdc(payout.amount);
  const { status, nonce, searchFrom } = payout;
  const search = (label: string) => (
    <button type="button" aria-disabled={!idle} onClick={() => act(() => findAuthorization(store, nonce, searchFrom))} className={BUTTON}>{searching ? "Searching the log…" : label}</button>
  );
  return (
    <li className="rounded border border-line-2 px-3 py-3 text-caption">
      <p className="flex justify-between gap-2"><span className="text-fg">Withdrawal {nonce}</span><span className="text-fg-2">{amount}</span></p>
      {status.kind === "paid" && <p className="mt-2 text-glow">Paid to your wallet.</p>}
      {status.kind !== "paid" && status.kind !== "waiting" && !payout.read && <p className="mt-2 text-fg-3">The vault&apos;s record of whether it was paid has not been read.</p>}
      {status.kind === "claimable" && (
        <>
          <p className="mt-2 text-fg-3">Authorized until {formatStamp(status.expiresAt * 1000)} UTC.</p>
          <button type="button" aria-disabled={!idle || !signs} aria-describedby={describedBy} onClick={() => signs && act(() => claim(store, nonce))} className={BUTTON}>Claim {amount} on the vault</button>
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
          <p className="mt-2 text-fg-3">Its authorization expired{payout.read ? " unclaimed" : ""} at {formatStamp(status.expiresAt * 1000)} UTC.</p>
          <button type="button" aria-disabled={!idle || !signs} aria-describedby={describedBy} onClick={() => signs && act(() => reissue(store, nonce, status.expiresAt, searchFrom))} className={BUTTON}>Ask for a new authorization</button>
          {search("Look for a newer one in the log")}
        </>
      )}
      {status.kind === "waiting" && (
        <>
          <p className="mt-2 text-fg-3">This page has not received its authorization. The node signs one once a checkpoint covering the approval is confirmed on chain; if the vault has paid it already, its record says so once the authorization is found.</p>
          {search("Look for it in the log")}
        </>
      )}
    </li>
  );
}
