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
  if (pending.kind === "reading") return <p className={NOTE}>Reading the epochs that have paid stakers…</p>;
  if (pending.kind === "none") return <p className={NOTE}>No USDC has been distributed to you yet. Stakers share the house&apos;s excess above its floor at each epoch close, less the operator&apos;s fifth while operator rotation is on.</p>;
  const paid = pending.paid === null ? `Epoch ${pending.epoch} closed and paid stakers.` : `Epoch ${pending.epoch} closed and paid ${formatUsdc(usdcFixed(pending.paid))} to stakers.`;
  if (pending.staker === null) return <p role="status" className={NOTE}>{paid} If you staked, your share shows here once the vault has the checkpoint covering it.</p>;
  const share = pending.share === null ? "" : ` If you were staking then, your share is about ${formatUsdc(usdcFixed(pending.share))}, estimated from your stake now.`;
  return <p role="status" className={NOTE}>{paid}{share} It becomes claimable once the vault has the checkpoint covering it, and is read again by itself.</p>;
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
            <Row label="Paid by the vault">—</Row>
            <Row label="Claimable">—</Row>
          </dl>
          <p className="sr-only">{proof === null ? "Reading your distributions…" : "Reading the vault's record of what it has paid…"}</p>
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
          {position.claimed !== null && <Row label="Paid by the vault">{formatUsdc(usdcFixed(position.claimed))}</Row>}
          {position.claimable > 0n && <Row label="Claimable">{formatUsdc(usdcFixed(position.claimable))}</Row>}
        </dl>
      )}
      {!reading && proof !== null && position.awaiting > 0n && <p className={NOTE}>{formatUsdc(usdcFixed(position.awaiting))} of this is not claimable yet; the rest follows once the vault reaches the newest checkpoint.</p>}
      {mine && !reading && <ReadNote read={figures.proof} />}
      {mine && figures.position.status === "failed" && <ReadNote read={figures.position} />}
      {mine && readOnly && proof !== null && <p role="status" className="text-caption leading-relaxed text-amber">Claiming is off: this account is read-only, so nothing can be signed for it. What the vault has paid is read from a wallet&apos;s own chain connection, which a watched account does not have.</p>}
      {mine && !readOnly && !reading && position.claimable > 0n && (
        <div>
          <button type="button" aria-disabled={busy || gate.blocked} aria-describedby={gate.describedBy} onClick={() => { if (!busy && !gate.blocked) void claimDistribution(panel).then(() => focusHeading("distributions-title")); }} className={`${BUTTON} w-full`}>
            Claim {formatUsdc(usdcFixed(position.claimable))} on the vault
          </button>
          {gate.note}
        </div>
      )}
      <Notice surface="distribution" />
      {mine && !readOnly && proof !== null && held === null && figures.position.status === "failed" && <p className={NOTE}>The vault&apos;s record of what it has paid could not be read; it is read again by itself.</p>}
      {mine && !readOnly && position.claimed !== null && position.checkpoint === "waiting" && position.accrued > position.claimed && <p className={NOTE}>The vault has not accepted a checkpoint covering this yet; the claim unlocks once it does. It is checked again by itself.</p>}
      {mine && !readOnly && position.claimed !== null && position.checkpoint === "posted" && position.claimable === 0n && position.accrued > 0n && <p className={NOTE}>All distributed USDC is claimed.</p>}
    </Card>
  );
}
