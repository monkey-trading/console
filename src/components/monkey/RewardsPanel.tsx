"use client";

/** Rewards: what stakers have been paid and the account's part of it. */

import { formatRate } from "@/lib/format";
import { shareBps, usdcFixed } from "@/lib/monkey/figures";
import { formatUsdc } from "@/lib/vault";

import { Card } from "./Card";
import { ReadNote } from "./ReadNote";
import { Row } from "./Row";
import { useConsoleSelect, usePanelState } from "./use-monkey";

export function RewardsPanel() {
  const { overview, wallet: figures } = usePanelState();
  const wallet = useConsoleSelect((state) => state.wallet);
  // The figures are for the account they name; while another account's are on screen, none show.
  const mine = wallet !== null && figures.address === wallet.address;
  const total = overview.value?.staking ?? null;
  const distribution = overview.value?.distribution ?? null;
  const position = mine ? figures.position.value : null;
  const share = position === null || !position.stakingEnabled || total === null ? null : shareBps(position.staked + (position.unstaking?.amount ?? 0n), BigInt(total.total_staked));
  return (
    <Card id="rewards-title" title="Rewards">
      <dl className="space-y-2">
        <Row label="USDC claimed">{position === null ? "—" : formatUsdc(usdcFixed(position.distributionsClaimed))}</Row>
        <Row label="Your share of stake">{share === null ? "—" : formatRate(share)}</Row>
        <Row label="Total distributed to stakers">{distribution === null ? "—" : formatUsdc(usdcFixed(BigInt(distribution.distributed_usdc_units)))}</Row>
        <Row label="Reward token">USDC</Row>
      </dl>
      <ReadNote read={overview} />
      {mine && figures.position.status === "failed" && <ReadNote read={figures.position} />}
    </Card>
  );
}
