"use client";

/**
 * The USDC the stakers' distributions have added to the account, what the vault has paid, and the
 * claim, which waits on a verdict that may sign since it is built from the node's proof. Until the
 * page load's wallet is settled and both reads that decide the claim have landed, the card holds the
 * claimable layout with dashes, so nothing below moves when they land.
 */

import { useId, useSyncExternalStore } from "react";

import { claimDistribution, distributionPosition } from "@/lib/monkey/actions";
import { usdcFixed } from "@/lib/monkey/figures";
import { pendingDistribution } from "@/lib/monkey/pending";
import type { EpochReads, EpochsState } from "@/lib/staking/epoch-reads";
import { formatUsdc } from "@/lib/vault";

import { Notice } from "../Notice";
import { useSignGate } from "../SignGate";
import { Card, focusHeading } from "./Card";
import { CloseCountdown } from "./Countdown";
import { ReadNote } from "./ReadNote";
import { Row } from "./Row";
import { BUTTON, NOTE } from "./styles";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "./use-monkey";

/** What the card says while the node holds no proof: what is known of the last paying epoch, never that nothing was distributed because no proof exists yet. */
function PendingLine({ pending }: { pending: ReturnType<typeof pendingDistribution> }) {
  if (pending.kind === "reading") return <p className={NOTE}>Loading recent distributions…</p>;
  if (pending.kind === "none") return <p className={NOTE}>No USDC has been distributed to you yet. At the end of each staking period, stakers share what the house holds above its reserve. While rotation is on, a fifth goes to the operator first.</p>;
  const paid = pending.paid === null ? `Staking period ${pending.epoch} ended and paid stakers.` : `Staking period ${pending.epoch} ended and paid ${formatUsdc(usdcFixed(pending.paid))} to stakers.`;
  if (pending.staker === null) return <p role="status" className={NOTE}>{paid} If you were staking, your share shows here after the vault&apos;s next update.</p>;
  const share = pending.share === null ? "" : ` If you were staking then, your share is about ${formatUsdc(usdcFixed(pending.share))}, based on your stake now.`;
  return <p role="status" className={NOTE}>{paid}{share} You can claim it after the vault&apos;s next update. This page checks automatically.</p>;
}

/** No closed epochs, for a card shown without the page's reads of them. */
const NO_EPOCHS = { subscribe: () => () => undefined, getSnapshot: (): EpochsState | null => null };

/** The card; `epochs`, the page's reads of the closed epochs, gives what a pending close paid stakers. */
export function DistributionClaim({ epochs = null }: { epochs?: EpochReads | null }) {
  const panel = useMonkeyPanel();
  const closes = useSyncExternalStore(epochs?.subscribe ?? NO_EPOCHS.subscribe, epochs?.getSnapshot ?? NO_EPOCHS.getSnapshot, epochs?.getSnapshot ?? NO_EPOCHS.getSnapshot);
  const { wallet: figures, overview, unmirroredTotal } = usePanelState();
  const wallet = useConsoleSelect((state) => state.wallet);
  const decided = useConsoleSelect((state) => state.walletDecided);
  const busy = useConsoleSelect((state) => state.busy);
  const gate = useSignGate(useId());
  const readOnly = wallet?.readOnly === true;
  // The figures are for the account they name: while another account's are on screen, none show.
  const mine = wallet !== null && figures.address === wallet.address;
  const proof = mine ? figures.proof.value : null;
  const held = mine ? figures.position.value : null;
  const position = distributionPosition(proof, held);
  // The closed epochs are checked as they are read, so each stakers' part is whole base units.
  const toStakers = (epoch: number) => {
    const close = closes?.epochs.find((entry) => entry.epoch === epoch);
    return close === undefined ? null : BigInt(close.stakers_usdc_units);
  };
  const pending = pendingDistribution(overview, figures.position, unmirroredTotal, toStakers);
  // Not read yet: no wallet the page load may still connect, the node's proof, or, beside a proof, the vault's record that decides the claim.
  const readingProof = wallet !== null && (!mine || figures.proof.status === "loading");
  const readingRecord = mine && !readOnly && proof !== null && held === null && figures.position.status === "loading";
  const reading = (wallet === null && !decided) || readingProof || readingRecord;
  return (
    <Card
      id="distributions-title"
      title="USDC distributions"
      aside={<CloseCountdown />}
    >
      {reading ? (
        <>
          <dl className="space-y-2">
            <Row label="Distributed to you">{proof === null ? "—" : formatUsdc(usdcFixed(position.accrued))}</Row>
            <Row label="Claimed">—</Row>
            <Row label="Claimable">—</Row>
          </dl>
          <p className="sr-only">{proof === null ? "Loading your distributions…" : "Checking how much you've claimed…"}</p>
          {/* The claim button's place, held while the reads that decide it run. */}
          <div aria-hidden="true" className={`${BUTTON} invisible w-full`}>Claim</div>
        </>
      ) : wallet === null ? (
        <p className={NOTE}>Connect a wallet to see your USDC distributions.</p>
      ) : proof === null && figures.proof.status === "ready" ? (
        <PendingLine pending={pending} />
      ) : proof === null ? null : (
        <dl className="space-y-2">
          <Row label="Distributed to you">{formatUsdc(usdcFixed(position.accrued))}</Row>
          {position.claimed !== null && <Row label="Claimed">{formatUsdc(usdcFixed(position.claimed))}</Row>}
          {position.claimable > 0n && <Row label="Claimable">{formatUsdc(usdcFixed(position.claimable))}</Row>}
        </dl>
      )}
      {!reading && proof !== null && position.awaiting > 0n && <p className={NOTE}>{formatUsdc(usdcFixed(position.awaiting))} of this can be claimed after the vault&apos;s next update.</p>}
      {mine && !reading && <ReadNote read={figures.proof} />}
      {mine && figures.position.status === "failed" && <ReadNote read={figures.position} />}
      {mine && readOnly && proof !== null && <p role="status" className="text-caption leading-relaxed text-amber">You can&apos;t claim from a read-only account.</p>}
      {mine && !readOnly && !reading && position.claimable > 0n && (
        <div>
          <button type="button" aria-disabled={busy || gate.blocked} aria-describedby={gate.describedBy} onClick={() => { if (!busy && !gate.blocked) void claimDistribution(panel).then(() => focusHeading("distributions-title")); }} className={`${BUTTON} w-full`}>
            Claim {formatUsdc(usdcFixed(position.claimable))}
          </button>
          {gate.note}
        </div>
      )}
      <Notice surface="distribution" />
      {mine && !readOnly && proof !== null && held === null && figures.position.status === "failed" && <p className={NOTE}>Couldn&apos;t check how much you&apos;ve claimed. Trying again automatically.</p>}
      {mine && !readOnly && position.claimed !== null && position.checkpoint === "waiting" && position.accrued > position.claimed && <p className={NOTE}>You can claim this after the vault&apos;s next update. This page checks automatically.</p>}
      {mine && !readOnly && position.claimed !== null && position.checkpoint === "posted" && position.claimable === 0n && position.accrued > 0n && <p className={NOTE}>You&apos;ve claimed all the USDC distributed to you.</p>}
    </Card>
  );
}
