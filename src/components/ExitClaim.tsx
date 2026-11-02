"use client";

/**
 * The vault's exit, step by step: start it once it is due, register what the saved proof holds, have
 * pending deposits refunded, and claim once the window has closed. Every step is the wallet's alone,
 * so none of it needs the node, and it asks nothing of the attestation banner above it.
 */

import { claimVaultExit, refundExitDeposit, registerExitClaims, startVaultExit } from "@/lib/store/exit-actions";
import { readingProof } from "@/lib/store/exit-state";
import { clause, stepKey, stepLabel, type ExitView } from "@/lib/store/exit-view";
import { formatUsdc, USDC_UNIT } from "@/lib/vault";

import { useConsole, useSession } from "./ConsoleProvider";

const BUTTON = "min-h-11 rounded border border-glow bg-glow/10 px-3 py-2 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0";
const STEP = "text-label tracking-caps text-fg-3 uppercase";

/** `settled` hears each action's end: it may have removed the button that ran it, so focus then goes somewhere deliberate. */
export function ExitClaim({ view, settled }: { view: ExitView; settled: () => void }) {
  const { busy, exit } = useConsole();
  const { store } = useSession();
  const held = busy || readingProof(exit);
  const unless = (run: () => Promise<void>) => () => { if (!held) void run().then(settled); };
  const { phase, registered } = view;
  const usdc = (units: bigint) => formatUsdc(units * USDC_UNIT);
  const open = phase === "open" && view.register.length > 0;
  return (
    <>
      {view.canStart && <button type="button" aria-disabled={held} onClick={unless(() => startVaultExit(store))} className={BUTTON}>Start the vault&apos;s exit</button>}
      {open && (
        <div className="space-y-2">
          <h4 className={STEP}>Step 1: register your claim</h4>
          <ul className="space-y-1 text-caption text-fg-2">{view.register.map((step) => <li key={stepKey(step)}>{stepLabel(step)}</li>)}</ul>
          <button type="button" aria-disabled={held} onClick={unless(() => registerExitClaims(store))} className={BUTTON}>Register, {view.register.length === 1 ? "one transaction" : `${view.register.length} transactions`}</button>
        </div>
      )}
      {(phase === "open" || phase === "closed") && exit.claimsProblem !== null && <p role="status" className="text-caption text-fg-2">Your wallet could not read what the vault holds for you: {clause(exit.claimsProblem)}. It is read again by itself.</p>}
      {(phase === "open" || phase === "closed") && registered !== null && (
        <div className="space-y-2">
          <h4 className={STEP}>{phase === "open" ? "Step 2: be paid" : "Be paid"}</h4>
          <p className="text-caption leading-relaxed text-fg-2">
            {exit.paid !== null ? `The vault paid ${usdc(exit.paid)} to your wallet.` : exit.claimed ? "The vault paid your claim." : registered > 0n ? `Registered: ${usdc(registered)}. ${phase === "open" ? "The vault pays it once the claim window closes, pro rata if it is short." : "The vault pays it now, pro rata if it is short."}` : phase === "open" ? "Nothing is registered yet." : "Nothing is registered for this account, or the vault has paid it."}
          </p>
          {view.canClaim && <button type="button" aria-disabled={held} onClick={unless(() => claimVaultExit(store))} className={BUTTON}>Claim from the vault</button>}
        </div>
      )}
      {view.refunds.length > 0 && (
        <div className="space-y-2">
          <h4 className={STEP}>Deposits to refund</h4>
          <ul className="space-y-2">
            {view.refunds.map((step) => (
              <li key={stepKey(step)} className="flex flex-wrap items-center justify-between gap-2 text-caption text-fg-2">
                <span>{stepLabel(step)}</span>
                <button type="button" aria-disabled={held} onClick={unless(() => refundExitDeposit(store, step))} className={BUTTON}>Refund<span className="sr-only"> {stepLabel(step)}</span></button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {exit.claims?.unheldComplete === false && <p className="text-caption text-amber">The vault holds more deposits than this page reads at once, so a deposit of yours may not be listed. Its id can be refunded on the vault directly.</p>}
    </>
  );
}
