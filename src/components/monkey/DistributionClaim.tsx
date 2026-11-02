"use client";

/** The USDC the stakers' distributions have added to the account, what the vault has paid, and the claim, which waits on a verdict that may sign since it is built from the node's proof. */

import { useId } from "react";

import { claimDistribution, distributionPosition } from "@/lib/monkey/actions";
import { usdcFixed } from "@/lib/monkey/figures";
import { formatUsdc } from "@/lib/vault";

import { Notice } from "../Notice";
import { useSignGate } from "../SignGate";
import { Card, focusHeading } from "./Card";
import { ReadNote } from "./ReadNote";
import { Row } from "./Row";
import { BUTTON, NOTE } from "./styles";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "./use-monkey";
import { useVerdict } from "./use-verdict";

export function DistributionClaim() {
  const panel = useMonkeyPanel();
  const { wallet: figures } = usePanelState();
  const wallet = useConsoleSelect((state) => state.wallet);
  const busy = useConsoleSelect((state) => state.busy);
  const gate = useSignGate(useId());
  const readOnly = wallet?.readOnly === true;
  // The figures are for the account they name: while another account's are on screen, none show.
  const mine = wallet !== null && figures.address === wallet.address;
  const proof = mine ? figures.proof.value : null;
  const held = mine ? figures.position.value : null;
  const position = distributionPosition(proof, held);
  const checkpoint = useVerdict(position.checkpoint);
  return (
    <Card
      id="distributions-title"
      title="USDC distributions"
    >
      {wallet === null ? (
        <p className={NOTE}>Connect a wallet to see your USDC distributions.</p>
      ) : !mine || figures.proof.status === "loading" ? (
        <p className={NOTE}>Reading your distributions…</p>
      ) : proof === null && figures.proof.status === "ready" ? (
        <p className={NOTE}>No USDC has been distributed to you yet. Stakers share the house&apos;s excess above its floor at each epoch close.</p>
      ) : proof === null ? null : (
        <dl className="space-y-2">
          <Row label="Distributed to you">{formatUsdc(usdcFixed(position.accrued))}</Row>
          {position.claimed !== null && <Row label="Paid by the vault">{formatUsdc(usdcFixed(position.claimed))}</Row>}
          {position.claimable > 0n && <Row label="Claimable">{formatUsdc(usdcFixed(position.claimable))}</Row>}
        </dl>
      )}
      {proof !== null && position.awaiting > 0n && <p className={NOTE}>{formatUsdc(usdcFixed(position.awaiting))} of this is not claimable yet; the rest follows once the vault reaches the newest checkpoint.</p>}
      {mine && <ReadNote read={figures.proof} />}
      {mine && figures.position.status === "failed" && <ReadNote read={figures.position} />}
      {mine && readOnly && proof !== null && <p role="status" className="text-caption leading-relaxed text-amber">Claiming is off: this account is read-only, so nothing can be signed for it. What the vault has paid is read from a wallet&apos;s own chain connection, which a watched account does not have.</p>}
      {mine && !readOnly && position.claimable > 0n && (
        <div>
          <button type="button" aria-disabled={busy || gate.blocked} aria-describedby={gate.describedBy} onClick={() => { if (!busy && !gate.blocked) void claimDistribution(panel).then(() => focusHeading("distributions-title")); }} className={`${BUTTON} w-full`}>
            Claim {formatUsdc(usdcFixed(position.claimable))} on the vault
          </button>
          {gate.note}
        </div>
      )}
      <Notice surface="distribution" />
      {mine && !readOnly && proof !== null && held === null && figures.position.status === "loading" && <p className={NOTE}>Reading the vault&apos;s record of what it has paid…</p>}
      {mine && !readOnly && proof !== null && held === null && figures.position.status === "failed" && <p className={NOTE}>The vault&apos;s record of what it has paid could not be read; it is read again by itself.</p>}
      {mine && !readOnly && position.claimed !== null && checkpoint === "checking" && <p role="status" className={NOTE}>Checking the vault&apos;s latest checkpoint against the node&apos;s proof…</p>}
      {mine && !readOnly && position.claimed !== null && checkpoint === "waiting" && position.accrued > position.claimed && <p className={NOTE}>The vault has not posted a checkpoint covering this yet; the claim unlocks once one posts. It is checked again by itself.</p>}
      {mine && !readOnly && position.claimed !== null && checkpoint === "superseded" && <p className={NOTE}>A newer checkpoint has posted on the vault; the claim unlocks once the node serves a proof against it. It is checked again by itself.</p>}
      {mine && !readOnly && position.claimed !== null && checkpoint === "posted" && position.claimable === 0n && position.accrued > 0n && <p className={NOTE}>All distributed USDC is claimed.</p>}
    </Card>
  );
}
