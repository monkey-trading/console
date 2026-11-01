"use client";

/** The account's MONKEY emissions: what the node's last posted root proves accrued, what the vault has minted, and the claim. */

import { useEffect, useId, useRef } from "react";

import { formatMonkey } from "@/lib/format";
import { checkEmissionsClaimed, claimEmissions, emissionsPosition, emissionsRecordStale } from "@/lib/store/emissions";

import { useConsole, useSession } from "./ConsoleProvider";
import { useReadOnlyNote } from "./SignGate";

const BUTTON = "mt-3 min-h-11 w-full rounded border border-glow bg-glow/10 px-3 py-2 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";

/** The MONKEY section at the foot of the Funding page, in every mode: the mock mirrors the accrual and the claim. */
export function EmissionsCard() {
  const state = useConsole();
  const { store } = useSession();
  const heading = useRef<HTMLHeadingElement>(null);
  const readOnly = useReadOnlyNote(useId(), "Claiming MONKEY");
  const proof = state.entitlement;
  const position = emissionsPosition(proof, state.emissionsVault);
  const address = state.wallet?.address;
  useEffect(() => {
    // The vault's own record settles the claimed-versus-accrued line and whether the proof's
    // checkpoint has posted; it is read again when the proof advances past it (`emissionsRecordStale`).
    if (address !== undefined && proof !== null && emissionsRecordStale(proof, state.emissionsVault, state.now, store.lastEmissionsReadAt)) void checkEmissionsClaimed(store);
  }, [store, address, proof, state.emissionsVault, state.now]);
  const act = (run: () => Promise<void>) => {
    if (state.busy) return;
    void run().then(() => heading.current?.focus());
  };
  const idle = !state.busy;
  const accrued = formatMonkey(position.accrued);
  return (
    <section aria-labelledby="monkey-title" className="rounded-xl border border-line-2 bg-ink-1 p-4">
      <h3 ref={heading} id="monkey-title" tabIndex={-1} className="text-label tracking-caps text-fg-3 uppercase outline-none">MONKEY emissions</h3>
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
            <button type="button" aria-disabled={!idle || readOnly.readOnly} aria-describedby={readOnly.describedBy} onClick={() => !readOnly.readOnly && act(() => claimEmissions(store))} className={BUTTON}>Claim {formatMonkey(position.claimable)} on the vault</button>
          )}
          {position.claimed !== null && position.checkpoint === "waiting" && position.accrued > position.claimed && (
            <p className="mt-2 text-fg-3">The vault has not posted a checkpoint covering this yet; the claim unlocks once one posts.</p>
          )}
          {position.claimed !== null && position.checkpoint === "superseded" && (
            <p className="mt-2 text-fg-3">A newer checkpoint has posted on the vault; the claim unlocks once the node serves a proof against it.</p>
          )}
          {position.claimed !== null && position.checkpoint === "posted" && position.claimable === 0n && position.accrued > 0n && (
            <p className="mt-2 text-fg-3">All accrued MONKEY is claimed.</p>
          )}
        </div>
      )}
    </section>
  );
}
