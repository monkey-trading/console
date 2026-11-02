"use client";

/** The distribution: what an epoch close would pay now, and when the last and next closes are. */

import { fixedFromWire, formatUsd } from "@/lib/fixed";
import { formatAgo, formatDuration, usdcFixed } from "@/lib/monkey/figures";
import { formatStamp } from "@/lib/time";
import { formatUsdc } from "@/lib/vault";

import { Card } from "./Card";
import { ReadNote } from "./ReadNote";
import { Row } from "./Row";
import { NOTE } from "./styles";
import { useConsoleSelect, usePanelState } from "./use-monkey";

export function DistributionPanel() {
  const { overview } = usePanelState();
  const nowMs = useConsoleSelect((state) => Math.floor(state.now / 60_000) * 60_000);
  const distribution = overview.value?.distribution ?? null;
  const last = distribution?.last_distribution ?? null;
  const lastClosed = last?.closed_ms ?? distribution?.last_closed_ms ?? null;
  return (
    <Card id="distribution-title" title="Distribution">
      {distribution !== null && (
        <>
          <dl className="space-y-2">
            <Row label="Excess above the floor now">{distribution.excess_usd === null ? "—" : formatUsd(fixedFromWire(distribution.excess_usd))}</Row>
            <Row label="Liquidity floor">{formatUsd(fixedFromWire(distribution.liquidity_floor))}</Row>
            <Row label="Last distribution">{lastClosed === null ? "None yet" : `${formatAgo(lastClosed, nowMs)}${last === null ? "" : `, ${formatUsdc(usdcFixed(BigInt(last.allocated_usdc_units)))}`}`}</Row>
            <Row label="Next close">{`${formatStamp(distribution.next_close_ms)} UTC, in ${formatDuration(distribution.next_close_ms - nowMs)}`}</Row>
          </dl>
          <p className={NOTE}>At each close, the house&apos;s NAV and cash above the floor, less deposits that can still reverse and clients&apos; debts, are shared between stakers in proportion to their stake.</p>
        </>
      )}
      {distribution === null && overview.status === "ready" && <p className={NOTE}>This node has not started distributions yet.</p>}
      <ReadNote read={overview} />
    </Card>
  );
}
