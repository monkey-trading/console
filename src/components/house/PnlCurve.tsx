"use client";

/**
 * The house's result for a price move of up to 1% either way, drawn as a straight line from the
 * market's net client exposure. It is the result before any close-out: closing positions out would
 * bend it, so it is labelled as an estimate rather than simulated.
 */

import { useCallback, useId, useState } from "react";

import { formatCompactUsd } from "@/lib/chart-format";
import { fixedToNumber, type Fixed } from "@/lib/fixed";
import { resultCurve } from "@/lib/house-bands";
import type { MarketId } from "@/lib/engine/types";
import { formatPrice } from "@/lib/price-format";
import type { ConsoleState } from "@/lib/store/state";

import { Pick } from "./Controls";
import { Panel, Quiet } from "./Panel";
import { useSelected } from "./use-feed";
import { useMarketOptions } from "./use-markets";

const RANGE_BPS = 100;
const STEP_BPS = 25;
const W = 300;
const H = 150;
const PAD = 8;

interface Stand {
  net: Fixed | null;
  mark: number | null;
  places: number;
}

/** The house's result for a price move of up to 1% either way in one market, as a straight line before close-outs. */
export function PnlCurve({ className }: { className?: string }) {
  const id = useId();
  const markets = useMarketOptions();
  const [picked, setPicked] = useState<MarketId | null>(null);
  const market = picked !== null && markets.some((m) => m.id === picked) ? picked : (markets[0]?.id ?? null);
  // Only the chosen market's scan row, so a streamed mark in any market leaves this panel alone.
  const select = useCallback((s: ConsoleState): Stand | null => {
    const row = s.house.scan?.markets.find((r) => r.market === market);
    const places = s.markets.find((m) => m.id === market)?.places;
    return row === undefined || places === undefined ? null : { net: row.net, mark: row.mark === null ? null : fixedToNumber(row.mark), places };
  }, [market]);
  const stand = useSelected(select);
  const net = stand?.net ?? null;
  const curve = net === null ? null : resultCurve(net, RANGE_BPS, STEP_BPS);
  const peak = curve === null ? 0 : Math.max(...curve.map((p) => Math.abs(p.usd)));
  const x = (bps: number) => PAD + ((bps + RANGE_BPS) / (2 * RANGE_BPS)) * (W - 2 * PAD);
  const y = (usd: number) => H / 2 - (peak === 0 ? 0 : (usd / peak) * (H / 2 - PAD));
  const path = curve === null ? "" : curve.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.bps).toFixed(1)} ${y(p.usd).toFixed(1)}`).join(" ");
  const first = curve?.[0];
  const last = curve?.[curve.length - 1];
  const price = (bps: number) => (stand?.mark === null || stand === null ? "" : formatPrice(stand.mark * (1 + bps / 10_000), stand.places));
  return (
    <Panel
      title="House P&L at ±1%"
      tip="The house's result if the index moved 1% either way from now, before any close-out. A straight line from the market's net client exposure: when clients are net long the house loses on a rise."
      className={className}
      controls={<Pick label="House P&L market" value={market ?? 0} options={markets.map((m) => ({ value: m.id, label: m.label }))} onChange={setPicked} />}
    >
      {curve === null || first === undefined || last === undefined ? (
        <Quiet>The node has not reported this market&apos;s net exposure yet.</Quiet>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`} className="h-auto w-full">
            <title id={`${id}-t`}>{`House result for a price move from -1% to +1%: ${formatCompactUsd(first.usd)} at -1%, ${formatCompactUsd(last.usd)} at +1%, before close-outs`}</title>
            <clipPath id={`${id}-up`}><rect x="0" y="0" width={W} height={H / 2} /></clipPath>
            <clipPath id={`${id}-down`}><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath>
            <path d={`${path} L${x(RANGE_BPS)} ${H / 2} L${x(-RANGE_BPS)} ${H / 2} Z`} clipPath={`url(#${id}-up)`} className="fill-glow/20" />
            <path d={`${path} L${x(RANGE_BPS)} ${H / 2} L${x(-RANGE_BPS)} ${H / 2} Z`} clipPath={`url(#${id}-down)`} className="fill-ember/20" />
            <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} className="stroke-line-2" />
            <line x1={x(0)} x2={x(0)} y1={PAD} y2={H - PAD} className="stroke-edge" strokeDasharray="3 3" />
            <path d={path} fill="none" strokeWidth="2" className="stroke-fg" />
          </svg>
          <div aria-hidden="true" className="flex justify-between text-label text-fg-3 tabular-nums">
            <span>-1% {price(-RANGE_BPS)}</span><span className="text-fg-2">{price(0)}</span><span>+1% {price(RANGE_BPS)}</span>
          </div>
          <p aria-hidden="true" className="flex justify-between text-caption tabular-nums">
            <span className={first.usd < 0 ? "text-ember" : "text-glow"}>{formatCompactUsd(first.usd)}</span>
            <span className={last.usd < 0 ? "text-ember" : "text-glow"}>{formatCompactUsd(last.usd)}</span>
          </p>
          <p className="text-label text-fg-3">A straight line from net exposure, before close-outs.</p>
        </>
      )}
    </Panel>
  );
}
