"use client";

/** The account's MONKEY emissions: what the node's last posted root proves accrued, what the vault has minted, and the claim. */

import { useId } from "react";

import { errorText, formatMonkey } from "@/lib/format";
import type { Pending, PendingEmission } from "@/lib/monkey/pending";
import { emissionsPosition } from "@/lib/store/emissions";
import { describeBoost } from "@/lib/tier-view";

import { useConsole } from "./ConsoleProvider";
import { focusHeading } from "./monkey/Card";
import { BudgetCountdown } from "./monkey/Countdown";
import { usePanelState } from "./monkey/use-monkey";
import { Notice } from "./Notice";
import { useReadOnlyNote, useSignGate } from "./SignGate";

const BUTTON = "mt-3 min-h-11 w-full rounded border border-glow bg-glow/10 px-3 py-2 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";

/**
 * The MONKEY emissions card on the MONKEY page, in every mode: the mock mirrors the accrual and the
 * claim. The vault's record of what it has minted is read by the page's wallet reads, on load, on
 * `refresh` and after a claim, never on the node's clock, and a read that failed or waits on the wallet says so;
 * `claim` sends the claim behind the page's other wallet work, so the provider is asked one thing at a time, and refreshes the page afterwards.
 * The claim is built from the node's proof, so its button waits on a verdict that may sign and says why.
 */
export function EmissionsCard({ claim, pending = { kind: "none" } }: { claim: () => Promise<unknown>; pending?: Pending<PendingEmission> }) {
  const state = useConsole();
  const readOnly = useReadOnlyNote(useId(), "Claiming MONKEY");
  const gate = useSignGate(useId());
  const proof = state.entitlement;
  const position = emissionsPosition(proof, state.emissionsVault);
  const { wallet: figures } = usePanelState();
  // The page's last read of the vault's record, for the account it names.
  const record = state.wallet !== null && figures.address === state.wallet.address ? figures.record : null;
  // The read's own reason; a generic one only for an error that carries none.
  const recordProblem = record?.status === "failed" ? (record.message ?? "") : null;
  const act = () => {
    if (state.busy) return;
    void claim().then(() => focusHeading("monkey-title"));
  };
  const idle = !state.busy;
  // From V68 the account's tier adds a share to its emission weight: undefined while the account is read, null from a node that does not serve it.
  const volume = state.account?.volume;
  const boost = volume === undefined ? (state.accountRead ? null : undefined) : volume.emissionsBoostBps === null ? null : { bps: volume.emissionsBoostBps, tier: volume.tier };
  const accrued = formatMonkey(position.accrued);
  // Not read yet: no wallet the page load may still connect, a connected one whose account, or whose closed periods, have not been read. The card then holds its claimable layout with a dash, as it does while the vault's record that decides the claim is read.
  const reading = state.wallet === null ? !state.walletDecided : !state.accountRead || (proof === null && pending.kind === "reading");
  // A watched account reads no vault and can claim nothing, so it holds no place for the button.
  const recordPending = proof !== null && position.claimed === null && recordProblem === null && state.wallet?.readOnly !== true;
  /** The claim button's place, held while the reads that decide it run. */
  const buttonSlot = <div aria-hidden="true" className={`${BUTTON} invisible`}>Claim</div>;
  return (
    <section aria-labelledby="monkey-title" className="rounded-xl border border-line-2 bg-ink-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 id="monkey-title" tabIndex={-1} className="text-label tracking-caps text-fg-3 uppercase outline-none">MONKEY emissions</h3>
        <BudgetCountdown />
      </div>
      {readOnly.note}
      {(state.wallet !== null || !state.walletDecided) && boost !== null && (
        <p className="mt-3 flex justify-between gap-2 text-caption"><span className="text-fg">Reward boost</span><span className="text-fg-2">{boost === undefined ? "—" : `${describeBoost(boost.bps)} for volume tier ${boost.tier}`}</span></p>
      )}
      {reading ? (
        <div className="mt-3 text-caption">
          <p className="flex justify-between gap-2"><span className="text-fg">Earned</span><span className="text-fg-2">—</span></p>
          <p className="mt-2 text-fg-3">Loading your MONKEY…</p>
          {buttonSlot}
        </div>
      ) : !state.wallet ? (
        <p className="mt-3 text-caption text-fg-3">Connect a wallet to see the MONKEY you have earned.</p>
      ) : proof === null ? (
        pending.kind === "awaiting" ? (
          <p role="status" className="mt-3 text-caption text-fg-3">You realised a loss in reward period {pending.period}, which has now ended. Any MONKEY you earned in that period can be claimed once the vault has recorded the next snapshot. This page checks for it automatically.</p>
        ) : (
          <p className="mt-3 text-caption text-fg-3">You have not yet earned any MONKEY. Every ten minutes, a fixed amount of MONKEY is distributed among the traders who realised a loss in that period, in proportion to the size of their losses.</p>
        )
      ) : (
        <div className="mt-3 text-caption">
          <p className="flex justify-between gap-2"><span className="text-fg">Earned</span><span className="text-fg-2">{accrued}</span></p>
          {position.claimed !== null ? (
            <p className="mt-2 text-fg-3">You have claimed {formatMonkey(position.claimed)} of the {accrued} you have earned.</p>
          ) : state.wallet.readOnly === true ? (
            // The console reads the chain only through a connected wallet, and a watched account has none (#288).
            <p className="mt-2 text-fg-3">The amount you have claimed can be checked only through a connected wallet, so it is not shown while you are viewing this account in read-only mode.</p>
          ) : (
            // One status line that changes its words, so a failure is announced.
            <p role="status" className={`mt-2 ${recordProblem === null ? "text-fg-3" : "text-amber"}`}>
              {recordProblem === null ? "Checking how much you have claimed…" : errorText("The amount you have claimed could not be checked.", recordProblem, "The app will try again automatically.")}
            </p>
          )}
          {recordPending && buttonSlot}
          {position.claimable > 0n && (
            <>
              <button type="button" aria-disabled={!idle || gate.blocked} aria-describedby={readOnly.describedBy ?? gate.describedBy} onClick={() => !gate.blocked && act()} className={BUTTON}>Claim {formatMonkey(position.claimable)}</button>
              {/* A read-only account's own note above already says why. */}
              {!readOnly.readOnly && gate.note}
            </>
          )}
          {position.awaiting > 0n && (
            <p className="mt-2 text-fg-3">{formatMonkey(position.awaiting)} of this amount can be claimed once the vault has recorded the next snapshot.</p>
          )}
          {position.claimed !== null && position.checkpoint === "waiting" && position.accrued > position.claimed && (
            <p className="mt-2 text-fg-3">The rest of your MONKEY can be claimed once the vault has recorded the next snapshot. This page checks for it automatically.</p>
          )}
          {position.claimed !== null && position.checkpoint === "posted" && position.claimable === 0n && position.accrued > 0n && (
            <p className="mt-2 text-fg-3">You have claimed all the MONKEY you have earned.</p>
          )}
        </div>
      )}
      <Notice surface="emissions" />
    </section>
  );
}
