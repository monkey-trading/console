"use client";

/**
 * The connected account's stake: what it holds, the forms to stake and to start an unstake, and an
 * unstake waiting out its cooldown. Until the page load's wallet is settled and its stake read, the
 * card holds that layout with dashes and its forms closed, so nothing below moves when it lands.
 */

import { formatMonkey, formatRate, shortHex } from "@/lib/format";
import { completeUnstake, stakeMonkey, startUnstake } from "@/lib/monkey/actions";
import { formatDuration, shareBps } from "@/lib/monkey/figures";
import type { StakeDelegations } from "@/lib/engine/staking";
import type { Read } from "@/lib/monkey/figures";
import { undelegatedOf } from "@/lib/staking/delegations";
import { unstakeWords } from "@/lib/staking/delegation-words";
import { withAddress } from "@/lib/staking/operator-cells";

import { Notice } from "../Notice";
import { AmountForm } from "./AmountForm";
import { Card, focusHeading } from "./Card";
import { ReadNote } from "./ReadNote";
import { Row } from "./Row";
import { BUTTON, NOTE } from "./styles";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "./use-monkey";

/** The longest figure the split rows are likely to show, laid out unseen so the split landing wraps nothing the dashes did not. */
const SPLIT_RESERVE = "12,345 MONKEY to 10 candidates";

/**
 * `delegations` is the chain's read of the account's delegations, which an unstake reduces, and
 * `labelOf` names their candidates; with it, the unstake waits for a fresh read, so its preview of
 * the reductions is never one from before the last transaction. Without it no reduction is shown.
 */
export function StakePanel({ delegations = null, labelOf = shortHex }: { delegations?: { read: Read<StakeDelegations>; settling: boolean } | null; labelOf?: (address: string) => string }) {
  const panel = useMonkeyPanel();
  const { wallet: figures, overview, unmirroredTotal, settling } = usePanelState();
  const wallet = useConsoleSelect((state) => state.wallet);
  const decided = useConsoleSelect((state) => state.walletDecided);
  const busy = useConsoleSelect((state) => state.busy);
  // The node's clock to five seconds, so the Complete button opens within moments of the cooldown ending; the time left is shown to the minute.
  const nowMs = useConsoleSelect((state) => Math.floor(state.now / 5_000) * 5_000);
  const mine = wallet !== null && figures.address === wallet.address;
  const position = mine ? figures.position.value : null;
  const staking = overview.value?.staking ?? null;
  const total = staking === null ? null : BigInt(staking.total_staked);
  const pending = position?.unstaking ?? null;
  // The engine counts an unstake as staked until it completes, so it counts in the share through the cooldown.
  // Until the node's total has caught up with a stake or a completed unstake, the wallet and the total disagree, so no share is shown.
  const share = position === null || total === null || unmirroredTotal !== null ? null : shareBps(position.staked + (pending?.amount ?? 0n), total);
  const left = pending === null ? 0 : pending.claimableAtMs - nowMs;
  const readOnly = wallet?.readOnly === true;
  // The delegations an unstake would reduce, as the chain last told them, never from before the last landed transaction.
  const held = delegations === null || delegations.settling ? null : delegations.read.value;
  // The stake's split as the chain last told it, beside the node's own figures.
  const split = delegations?.read.value ?? null;
  const undelegated = split === null ? null : undelegatedOf(split.staked, split.delegations);
  // Not read yet: no wallet the page load may still connect, or a connected one whose stake has not landed.
  const reading = wallet === null ? !decided : !readOnly && position === null && (!mine || figures.position.status === "loading");
  return (
    <Card
      id="stake-title"
      title="Your stake"
    >
      {reading || position?.stakingEnabled === true ? (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
            <Row label="Staked">{position === null ? "—" : formatMonkey(position.staked)}</Row>
            <Row label="Delegated" reserve={SPLIT_RESERVE}>{split === null ? "—" : `${formatMonkey(split.delegated)} to ${split.delegations.length} ${split.delegations.length === 1 ? "candidate" : "candidates"}`}</Row>
            <Row label="Undelegated" reserve={SPLIT_RESERVE}>{split === null || undelegated === null ? "—" : `${formatMonkey(undelegated)}${undelegated > 0n ? " (abstains)" : ""}`}</Row>
            <Row label="Wallet balance">{position === null ? "—" : formatMonkey(position.balance)}</Row>
            <Row label="Share of all stake">{share === null ? "—" : formatRate(share)}</Row>
          </dl>
          {reading ? <p className="sr-only">Reading your stake…</p> : <ReadNote read={figures.position} />}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <AmountForm field="stake" label="Stake" action="Stake" max={position?.balance ?? 0n} maxLabel="your wallet balance" disabled={busy || settling || position === null} onSubmit={(amount, onLanded) => stakeMonkey(panel, amount, onLanded)} />
            <AmountForm
              field="unstake" label="Unstake" action="Start unstake" max={position?.staked ?? 0n} maxLabel="your stake"
              disabled={busy || settling || position === null || (delegations !== null && held === null)}
              onSubmit={(amount, onLanded) => startUnstake(panel, amount, onLanded)}
              // Always laid out, empty until the chain's read can say what an unstake reduces, so its arrival moves nothing.
              preview={(amount) => (held === null ? null : unstakeWords(held.staked, held.delegations, amount, (address) => withAddress(labelOf(address), address)))}
            />
          </div>
          {delegations !== null && delegations.read.status === "failed" && <ReadNote read={delegations.read} />}
          <Notice surface="stake" />
          <p className={NOTE}>
            An unstake takes your undelegated stake first, then the rest from each of your delegations in proportion to its size. {staking === null ? "It waits out a cooldown before it can be completed." : `It waits ${formatDuration(staking.cooldown_ms)} before it can be completed.`} Until then it still counts as staked, so it stays in your share.
          </p>
          {pending !== null && (
            <div className="space-y-2 rounded border border-line-2 p-3">
              <p className="text-caption text-fg">Unstaking {formatMonkey(pending.amount)}</p>
              <p className={NOTE}>{left > 0 ? `${formatDuration(left)} left in the cooldown.` : "The cooldown has passed."}</p>
              <button type="button" aria-disabled={busy || left > 0} onClick={() => { if (!busy && left <= 0) void completeUnstake(panel).then(() => focusHeading("stake-title")); }} className={`${BUTTON} w-full`}>Complete unstake</button>
            </div>
          )}
        </>
      ) : wallet === null ? (
        <p className={NOTE}>Connect a wallet to stake or unstake MONKEY.</p>
      ) : readOnly ? (
        <p role="status" className="text-caption leading-relaxed text-amber">This account is read-only. Its stake and wallet balance are read through a wallet&apos;s own chain connection, and nothing can be signed for it.</p>
      ) : position === null ? (
        <ReadNote read={figures.position} loading="Reading your stake…" />
      ) : (
        <>
          <dl className="space-y-2"><Row label="Wallet balance">{formatMonkey(position.balance)}</Row></dl>
          <ReadNote read={figures.position} />
          <p className={NOTE}>This build names no staking contract, so staking and unstaking are not available here.</p>
        </>
      )}
    </Card>
  );
}
