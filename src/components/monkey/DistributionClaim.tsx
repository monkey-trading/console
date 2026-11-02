"use client";

/** The USDC the stakers' distributions have added to the account, what the vault has paid, and the claim. */

import { claimDistribution, distributionPosition } from "@/lib/monkey/actions";
import { usdcFixed } from "@/lib/monkey/figures";
import { formatUsdc } from "@/lib/vault";

import { Card, focusHeading } from "./Card";
import { ReadNote } from "./ReadNote";
import { Row } from "./Row";
import { BUTTON, LINK_BUTTON, NOTE } from "./styles";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "./use-monkey";

export function DistributionClaim() {
  const panel = useMonkeyPanel();
  const { wallet: figures } = usePanelState();
  const wallet = useConsoleSelect((state) => state.wallet);
  const busy = useConsoleSelect((state) => state.busy);
  const readOnly = wallet?.readOnly === true;
  // The figures are for the account they name: while another account's are on screen, none show.
  const mine = wallet !== null && figures.address === wallet.address;
  const proof = mine ? figures.proof.value : null;
  const held = mine ? figures.position.value : null;
  const position = distributionPosition(proof, held);
  return (
    <Card
      id="distributions-title"
      title="USDC distributions"
      aside={wallet !== null && !readOnly && <button type="button" onClick={() => void panel.refreshWallet(true)} className={LINK_BUTTON}>Refresh<span className="sr-only"> your distributions</span></button>}
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
      {mine && <ReadNote read={figures.proof} />}
      {mine && figures.position.status === "failed" && <ReadNote read={figures.position} />}
      {mine && readOnly && proof !== null && <p role="status" className="text-caption leading-relaxed text-amber">Claiming is off: this account is read-only, so nothing can be signed for it. What the vault has paid is read from a wallet&apos;s own chain connection, which a watched account does not have.</p>}
      {mine && !readOnly && position.claimable > 0n && (
        <button type="button" aria-disabled={busy} onClick={() => { if (!busy) void claimDistribution(panel).then(() => focusHeading("distributions-title")); }} className={`${BUTTON} w-full`}>
          Claim {formatUsdc(usdcFixed(position.claimable))} on the vault
        </button>
      )}
      {mine && !readOnly && proof !== null && held === null && figures.position.status !== "loading" && <p className={NOTE}>The vault&apos;s record of what it has paid has not been read. Refresh to read it.</p>}
      {mine && !readOnly && position.claimed !== null && position.checkpoint === "waiting" && position.accrued > position.claimed && <p className={NOTE}>The vault has not posted a checkpoint covering this yet. Refresh to check again; the claim unlocks once one posts.</p>}
      {mine && !readOnly && position.claimed !== null && position.checkpoint === "superseded" && <p className={NOTE}>A newer checkpoint has posted on the vault. Refresh to read the node&apos;s proof against it; the claim unlocks once it serves one.</p>}
      {mine && !readOnly && position.claimed !== null && position.checkpoint === "posted" && position.claimable === 0n && position.accrued > 0n && <p className={NOTE}>All distributed USDC is claimed.</p>}
    </Card>
  );
}
