"use client";

/** The account's MONKEY emissions: what the node's last posted root proves accrued, what the vault has minted, and the claim. */

import { useId } from "react";

import { formatMonkey } from "@/lib/format";
import { emissionsPosition } from "@/lib/store/emissions";

import { useConsole } from "./ConsoleProvider";
import { focusHeading } from "./monkey/Card";
import { useVerdict } from "./monkey/use-verdict";
import { Notice } from "./Notice";
import { useReadOnlyNote, useSignGate } from "./SignGate";

const BUTTON = "mt-3 min-h-11 w-full rounded border border-glow bg-glow/10 px-3 py-2 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";

/**
 * The MONKEY emissions card on the MONKEY page, in every mode: the mock mirrors the accrual and the
 * claim. The vault's record of what it has minted is read by the page's wallet reads, on load, on
 * `refresh` and after a claim, never on the node's clock;
 * `claim` sends the claim behind the page's other wallet work, so the provider is asked one thing at a time, and refreshes the page afterwards.
 * The claim is built from the node's proof, so its button waits on a verdict that may sign and says why.
 */
export function EmissionsCard({ claim }: { claim: () => Promise<unknown> }) {
  const state = useConsole();
  const readOnly = useReadOnlyNote(useId(), "Claiming MONKEY");
  const gate = useSignGate(useId());
  const proof = state.entitlement;
  const position = emissionsPosition(proof, state.emissionsVault);
  const checkpoint = useVerdict(position.checkpoint);
  const act = () => {
    if (state.busy) return;
    void claim().then(() => focusHeading("monkey-title"));
  };
  const idle = !state.busy;
  const accrued = formatMonkey(position.accrued);
  return (
    <section aria-labelledby="monkey-title" className="rounded-xl border border-line-2 bg-ink-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id="monkey-title" tabIndex={-1} className="text-label tracking-caps text-fg-3 uppercase outline-none">MONKEY emissions</h3>
      </div>
      {readOnly.note}
      {!state.wallet ? (
        <p className="mt-3 text-caption text-fg-3">Connect a wallet to see your MONKEY emissions.</p>
      ) : !state.accountRead ? (
        <p className="mt-3 text-caption text-fg-3">Reading your MONKEY emissions…</p>
      ) : proof === null ? (
        <p className="mt-3 text-caption text-fg-3">No MONKEY accrued yet. MONKEY accrues from the engine&apos;s fixed ten-minute emission budgets, shared between the accounts that realised a loss in each period.</p>
      ) : (
        <div className="mt-3 text-caption">
          <p className="flex justify-between gap-2"><span className="text-fg">Accrued</span><span className="text-fg-2">{accrued}</span></p>
          {position.claimed !== null ? (
            <p className="mt-2 text-fg-3">Claimed {formatMonkey(position.claimed)} of {accrued} accrued.</p>
          ) : (
            <p className="mt-2 text-fg-3">Reading the vault&apos;s record of what it has minted…</p>
          )}
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
          {position.claimed !== null && checkpoint === "checking" && (
            <p role="status" className="mt-2 text-fg-3">Checking the vault&apos;s latest checkpoint against the node&apos;s proof…</p>
          )}
          {position.claimed !== null && checkpoint === "waiting" && position.accrued > position.claimed && (
            <p className="mt-2 text-fg-3">The vault has not posted a checkpoint covering this yet; the claim unlocks once one posts. It is checked again by itself.</p>
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
