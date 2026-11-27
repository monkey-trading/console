"use client";

/** The account's approved withdrawals and their claims on the vault: claim, wait for the next checkpoint, or ask for a fresh authorization. */

import { useEffect, useId, useRef } from "react";

import { readBlock } from "@/lib/engine/attestation";
import { emptySince, historyBeginsNote, withdrawalsBegin } from "@/lib/store/history-begins";
import { checkReadDelay, earliestCheck, STILL_WAITING_MS, waitsForInstallation, waitsForRoutineCheck } from "@/lib/store/payout-checks";
import { waitingWords } from "@/lib/store/payout-words";
import { checkPaid, claim, loadApprovals, loadPayouts, payoutsOf, reissue, unreadPayouts, type Payout } from "@/lib/store/payouts";
import { formatStamp } from "@/lib/time";
import { formatUsdc } from "@/lib/vault";

import { useConsole, useSession } from "./ConsoleProvider";
import { Notice } from "./Notice";
import { useReadOnlyNote } from "./SignGate";

const BUTTON = "mt-3 min-h-11 w-full rounded border border-glow bg-glow/10 px-3 py-2 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";

/** The claims section of the Funding page's In progress column, for a live node. */
export function Payouts() {
  const state = useConsole();
  const { store } = useSession();
  const heading = useRef<HTMLHeadingElement>(null);
  const readOnly = useReadOnlyNote(useId(), "Claiming and renewing withdrawals");
  const payouts = payoutsOf(state);
  const address = state.wallet?.address;
  const begins = withdrawalsBegin(state);
  // A new approval reaches the recent history first; it prompts a fresh read of every approval and of the node's payouts.
  const latest = state.history.find((e) => e.type === "withdrawal_approved")?.cursor ?? "";
  const unread = unreadPayouts(state).join(",");
  // A wallet reattaches on page load before the node has attested: the reads wait for it, then run.
  const trusted = readBlock(state.attestation, state.stream) === null;
  useEffect(() => {
    if (address === undefined || !trusted) return;
    void loadApprovals(store);
    void loadPayouts(store);
  }, [store, address, latest, trusted]);
  // An unsigned approval waits for a log check at a boundary the node names: its payouts are read again just after it, and while the node still names it, so the row never keeps saying a past boundary is next.
  // One waiting for an operator's installation has no time, so it is read at the slow pace.
  const checkAt = earliestCheck(payouts);
  // One waiting for a routine check within the turn has none either, and is read at the slow pace as well (monkey-trading/console#535).
  const untimed = waitsForInstallation(payouts) || waitsForRoutineCheck(payouts);
  const nowMs = state.now;
  // Each attempt, failed or partial ones included, changes the generation, so each arms the next.
  const attempt = state.payoutsGeneration;
  useEffect(() => {
    if ((checkAt === null && !untimed) || !trusted) return;
    const load = () => void loadPayouts(store);
    // The node's clock as it is when the timer is set, so a clock that moves on never sets it again.
    const timer = setTimeout(() => {
      // A hidden tab reads once it is seen again, as the other paced reads do.
      if (document.visibilityState === "hidden") document.addEventListener("visibilitychange", load, { once: true });
      else load();
    }, checkAt === null ? STILL_WAITING_MS : Math.min(checkReadDelay(checkAt, store.getSnapshot().now), untimed ? STILL_WAITING_MS : Infinity));
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [store, checkAt, untimed, trusted, attempt]);
  useEffect(() => {
    // The vault's own record says whether it has paid each payout the page can act on, including by a claim made elsewhere before the read.
    if (unread !== "") void checkPaid(store);
  }, [store, unread]);
  // An action replaces or settles the row's button, so focus returns to the section's heading.
  const act = (run: () => Promise<void>) => {
    if (state.busy) return;
    void run().then(() => heading.current?.focus());
  };
  const idle = !state.busy;
  return (
    <section aria-labelledby="payouts-title" className="p-4">
      <h4 ref={heading} id="payouts-title" tabIndex={-1} className="text-label tracking-caps text-fg-3 uppercase outline-none">Approved withdrawals</h4>
      {readOnly.note}
      <Notice surface="payoutReads" />
      <Notice surface="payoutVault" />
      {payouts.length === 0 ? (
        <p className="mt-3 text-caption text-fg-3">{state.wallet ? (begins === null ? "You have no approved withdrawals yet." : emptySince("withdrawals", begins)) : "Connect a wallet to see your withdrawals."}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {payouts.map((payout) => <PayoutRow key={payout.nonce} payout={payout} nowMs={nowMs} idle={idle} signs={!readOnly.readOnly} describedBy={readOnly.describedBy} problem={state.payoutsProblem} act={act} />)}
        </ul>
      )}
      <Notice surface="payouts" />
      {begins !== null && payouts.length > 0 && <p className="mt-3 text-label text-fg-3">{historyBeginsNote("withdrawals", begins)}</p>}
      {state.approvalsNext !== null && (
        <button type="button" aria-disabled={!idle} onClick={() => act(() => loadApprovals(store, true))} className={BUTTON}>Load older withdrawals</button>
      )}
    </section>
  );
}

/** One approved withdrawal and the actions its status allows; `act` runs one unless another is in flight. */
function PayoutRow({ payout, nowMs, idle, signs, describedBy, problem, act }: { payout: Payout; /** The node's clock, which says whether a named boundary has passed. */ nowMs: number; idle: boolean; /** False for a read-only account, which cannot claim or ask for a signature. */ signs: boolean; describedBy: string | undefined; /** Why the node's payouts could not be read, if they could not. */ problem: string | null; act: (run: () => Promise<void>) => void }) {
  const { store } = useSession();
  const amount = formatUsdc(payout.amount);
  const { status, nonce } = payout;
  return (
    <li className="rounded border border-line-2 px-3 py-3 text-caption">
      <p className="flex justify-between gap-2"><span className="text-fg">Withdrawal {nonce}</span><span className="text-fg-2">{amount}</span></p>
      {status.kind === "paid" && <p className="mt-2 text-glow">The withdrawal has been paid to your wallet.</p>}
      {status.kind !== "paid" && status.kind !== "waiting" && !payout.read && <p className="mt-2 text-fg-3">The app has not yet checked whether the vault has paid the withdrawal.</p>}
      {status.kind === "claimable" && (
        <>
          <p className="mt-2 text-fg-3">The withdrawal can be claimed until {formatStamp(status.expiresAt * 1000)} UTC.</p>
          <button type="button" aria-disabled={!idle || !signs} aria-describedby={describedBy} onClick={() => signs && act(() => claim(store, nonce))} className={BUTTON}>Claim {amount} from the vault</button>
        </>
      )}
      {status.kind === "expired" && (
        <>
          <p className="mt-2 text-fg-3">The approval for this withdrawal expired at {formatStamp(status.expiresAt * 1000)} UTC{payout.read ? " before it was claimed" : ""}. Select Renew the claim to request a new approval from the server.</p>
          <button type="button" aria-disabled={!idle || !signs} aria-describedby={describedBy} onClick={() => signs && act(() => reissue(store, nonce, status.expiresAt))} className={BUTTON}>Renew the claim</button>
        </>
      )}
      {status.kind === "waiting" && !payout.read && status.checkAtMs === undefined && status.installation !== true && status.routine !== true && (
        <p className="mt-2 text-fg-3">{signs ? "Checking the vault…" : "The vault cannot be checked for the withdrawal while you are viewing this account in read-only mode."}</p>
      )}
      {status.kind === "waiting" && (payout.read || status.checkAtMs !== undefined || status.installation === true || status.routine === true) && <p className="mt-2 text-fg-3">{waitingWords(status.checkAtMs, nowMs, status.installation === true, status.routine === true)}</p>}
      {problem !== null && (status.kind === "waiting" || status.kind === "expired") && <p className="mt-2 text-fg-3">{problem}</p>}
    </li>
  );
}
