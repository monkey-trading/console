"use client";

/** The account's MONKEY emissions: what the node's last posted root proves accrued, what the vault has minted, and the claim. */

import { useId } from "react";

import { formatMonkey } from "@/lib/format";
import { emissionsPosition } from "@/lib/store/emissions";

import { useConsole } from "./ConsoleProvider";
import { focusHeading } from "./monkey/Card";
import { useReadOnlyNote } from "./SignGate";

const BUTTON = "mt-3 min-h-11 w-full rounded border border-glow bg-glow/10 px-3 py-2 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";

/**
 * The MONKEY emissions card on the MONKEY page, in every mode: the mock mirrors the accrual and the
 * claim. The vault's record of what it has minted is read by the page's wallet reads, on load, on
 * `refresh` and after a claim, never on the node's clock;
 * `claim` sends the claim behind the page's other wallet work, so the provider is asked one thing at a time, and refreshes the page afterwards.
 */
export function EmissionsCard({ refresh, claim }: { refresh: () => void; claim: () => Promise<unknown> }) {
  const state = useConsole();
  const readOnly = useReadOnlyNote(useId(), "Claiming MONKEY");
  const proof = state.entitlement;
  const position = emissionsPosition(proof, state.emissionsVault);
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
        {state.wallet !== null && state.wallet.readOnly !== true && <button type="button" onClick={refresh} className="min-h-6 rounded px-1 text-label text-fg-3 underline hover:text-glow focus-visible:outline-2 focus-visible:outline-glow">Refresh<span className="sr-only"> your MONKEY emissions</span></button>}
      </div>
      {readOnly.note}
      {!state.wallet ? (
        <p className="mt-3 text-caption text-fg-3">Connect a wallet to see your MONKEY emissions.</p>
      ) : proof === null ? (
        <p className="mt-3 text-caption text-fg-3">No MONKEY accrued yet. MONKEY accrues from the engine&apos;s fixed ten-minute emission budgets, shared between the accounts that realised a loss in each period.</p>
      ) : (
        <div className="mt-3 text-caption">
          <p className="flex justify-between gap-2"><span className="text-fg">Accrued</span><span className="text-fg-2">{accrued}</span></p>
          {position.claimed !== null ? (
            <p className="mt-2 text-fg-3">Claimed {formatMonkey(position.claimed)} of {accrued} accrued.</p>
          ) : (
            <p className="mt-2 text-fg-3">The vault&apos;s record of what it has minted has not been read.</p>
          )}
          {position.claimable > 0n && (
            <button type="button" aria-disabled={!idle || readOnly.readOnly} aria-describedby={readOnly.describedBy} onClick={() => !readOnly.readOnly && act()} className={BUTTON}>Claim {formatMonkey(position.claimable)} on the vault</button>
          )}
          {position.claimed !== null && position.checkpoint === "waiting" && position.accrued > position.claimed && (
            <p className="mt-2 text-fg-3">The vault has not posted a checkpoint covering this yet; the claim unlocks once one posts. Refresh to check again.</p>
          )}
          {position.claimed !== null && position.checkpoint === "superseded" && (
            <p className="mt-2 text-fg-3">A newer checkpoint has posted on the vault; the claim unlocks once the node serves a proof against it. Refresh to check again.</p>
          )}
          {position.claimed !== null && position.checkpoint === "posted" && position.claimable === 0n && position.accrued > 0n && (
            <p className="mt-2 text-fg-3">All accrued MONKEY is claimed.</p>
          )}
        </div>
      )}
    </section>
  );
}
