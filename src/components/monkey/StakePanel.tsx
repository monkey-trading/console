"use client";

/** The connected account's stake: what it holds, the forms to stake and to start an unstake, and an unstake waiting out its cooldown. */

import { formatMonkey, formatRate } from "@/lib/format";
import { completeUnstake, stakeMonkey, startUnstake } from "@/lib/monkey/actions";
import { formatDuration, shareBps } from "@/lib/monkey/figures";

import { AmountForm } from "./AmountForm";
import { Card, focusHeading } from "./Card";
import { ReadNote } from "./ReadNote";
import { Row } from "./Row";
import { BUTTON, LINK_BUTTON, NOTE } from "./styles";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "./use-monkey";

export function StakePanel() {
  const panel = useMonkeyPanel();
  const { wallet: figures, overview } = usePanelState();
  const wallet = useConsoleSelect((state) => state.wallet);
  const busy = useConsoleSelect((state) => state.busy);
  // The node's clock to five seconds, so the Complete button opens within moments of the cooldown ending; the time left is shown to the minute.
  const nowMs = useConsoleSelect((state) => Math.floor(state.now / 5_000) * 5_000);
  const mine = wallet !== null && figures.address === wallet.address;
  const position = mine ? figures.position.value : null;
  const staking = overview.value?.staking ?? null;
  const total = staking === null ? null : BigInt(staking.total_staked);
  const pending = position?.unstaking ?? null;
  // The engine counts an unstake as staked until it completes, so it counts in the share through the cooldown.
  const share = position === null || total === null ? null : shareBps(position.staked + (pending?.amount ?? 0n), total);
  const left = pending === null ? 0 : pending.claimableAtMs - nowMs;
  const readOnly = wallet?.readOnly === true;
  return (
    <Card
      id="stake-title"
      title="Your stake"
      aside={wallet !== null && !readOnly && <button type="button" onClick={() => void panel.refreshWallet(true)} className={LINK_BUTTON}>Refresh<span className="sr-only"> your stake</span></button>}
    >
      {wallet === null ? (
        <p className={NOTE}>Connect a wallet to stake or unstake MONKEY.</p>
      ) : readOnly ? (
        <p role="status" className="text-caption leading-relaxed text-amber">This account is read-only. Its stake and wallet balance are read through a wallet&apos;s own chain connection, and nothing can be signed for it.</p>
      ) : position === null ? (
        <ReadNote read={mine ? figures.position : { status: "loading", value: null, message: null }} loading="Reading your stake…" />
      ) : !position.stakingEnabled ? (
        <>
          <dl className="space-y-2"><Row label="Wallet balance">{formatMonkey(position.balance)}</Row></dl>
          <ReadNote read={figures.position} />
          <p className={NOTE}>This build names no staking contract, so staking and unstaking are not available here.</p>
        </>
      ) : (
        <>
          <dl className="space-y-2">
            <Row label="Staked">{formatMonkey(position.staked)}</Row>
            <Row label="Wallet balance">{formatMonkey(position.balance)}</Row>
            <Row label="Share of all stake">{share === null ? "—" : formatRate(share)}</Row>
          </dl>
          <ReadNote read={figures.position} />
          <AmountForm label="Stake" action="Stake" max={position.balance} maxLabel="your wallet balance" disabled={busy} onSubmit={(amount) => stakeMonkey(panel, amount)} />
          <AmountForm label="Unstake" action="Start unstake" max={position.staked} maxLabel="your stake" disabled={busy} onSubmit={(amount) => startUnstake(panel, amount)} />
          <p className={NOTE}>
            {staking === null ? "An unstake waits out a cooldown before it can be completed." : `An unstake waits ${formatDuration(staking.cooldown_ms)} before it can be completed.`} Until then it still counts as staked, so it stays in your share.
          </p>
          {pending !== null && (
            <div className="space-y-2 rounded border border-line-2 p-3">
              <p className="text-caption text-fg">Unstaking {formatMonkey(pending.amount)}</p>
              <p className={NOTE}>{left > 0 ? `${formatDuration(left)} left in the cooldown.` : "The cooldown has passed."}</p>
              <button type="button" aria-disabled={busy || left > 0} onClick={() => { if (!busy && left <= 0) void completeUnstake(panel).then(() => focusHeading("stake-title")); }} className={`${BUTTON} w-full`}>Complete unstake</button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
