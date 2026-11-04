"use client";

/** The account's MONKEY emissions: what the node's last posted root proves accrued, what the vault has minted, and the claim. */

import { useId } from "react";

import { formatMonkey } from "@/lib/format";
import type { Pending, PendingEmission } from "@/lib/monkey/pending";
import { emissionsPosition } from "@/lib/store/emissions";

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
  const recordProblem = record?.status === "failed" ? (record.message || "the read failed").replace(/\.+$/, "") : null;
  const act = () => {
    if (state.busy) return;
    void claim().then(() => focusHeading("monkey-title"));
  };
  const idle = !state.busy;
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
      {reading ? (
        <div className="mt-3 text-caption">
          <p className="flex justify-between gap-2"><span className="text-fg">Accrued</span><span className="text-fg-2">—</span></p>
          <p className="mt-2 text-fg-3">Reading your MONKEY emissions…</p>
          {buttonSlot}
        </div>
      ) : !state.wallet ? (
        <p className="mt-3 text-caption text-fg-3">Connect a wallet to see your MONKEY emissions.</p>
      ) : proof === null ? (
        pending.kind === "awaiting" ? (
          <p role="status" className="mt-3 text-caption text-fg-3">You realised a loss in emission period {pending.period}, which has closed. Any MONKEY it earned you becomes claimable once the vault has the checkpoint covering it, and is read again by itself.</p>
        ) : (
          <p className="mt-3 text-caption text-fg-3">No MONKEY accrued yet. MONKEY accrues from the engine&apos;s fixed ten-minute emission budgets, shared between the accounts that realised a loss in each period.</p>
        )
      ) : (
        <div className="mt-3 text-caption">
          <p className="flex justify-between gap-2"><span className="text-fg">Accrued</span><span className="text-fg-2">{accrued}</span></p>
          {position.claimed !== null ? (
            <p className="mt-2 text-fg-3">Claimed {formatMonkey(position.claimed)} of {accrued} accrued.</p>
          ) : (
            // One status line that changes its words, so a failure is announced.
            <p role="status" className={`mt-2 ${recordProblem === null ? "text-fg-3" : "text-amber"}`}>
              {recordProblem === null ? "Reading the vault's record of what it has minted…" : `Could not read the vault's record of what it has minted: ${recordProblem}. It is read again by itself.`}
            </p>
          )}
          {recordPending && buttonSlot}
          {position.claimable > 0n && (
            <>
              <button type="button" aria-disabled={!idle || gate.blocked} aria-describedby={readOnly.describedBy ?? gate.describedBy} onClick={() => !gate.blocked && act()} className={BUTTON}>Claim {formatMonkey(position.claimable)} on the vault</button>
              {/* A read-only account's own note above already says why. */}
              {!readOnly.readOnly && gate.note}
            </>
          )}
          {position.awaiting > 0n && (
            <p className="mt-2 text-fg-3">{formatMonkey(position.awaiting)} of this is not claimable yet; the rest follows once the vault reaches the newest checkpoint.</p>
          )}
          {position.claimed !== null && position.checkpoint === "waiting" && position.accrued > position.claimed && (
            <p className="mt-2 text-fg-3">The vault has not accepted a checkpoint covering this yet; the claim unlocks once it does. It is checked again by itself.</p>
          )}
          {position.claimed !== null && position.checkpoint === "posted" && position.claimable === 0n && position.accrued > 0n && (
            <p className="mt-2 text-fg-3">All accrued MONKEY is claimed.</p>
          )}
        </div>
      )}
      <Notice surface="emissions" />
    </section>
  );
}
