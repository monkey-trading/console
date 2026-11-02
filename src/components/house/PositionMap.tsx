"use client";

/**
 * The position map: for one market, the notional of clients' positions by how much each is up or
 * down, shorts to the left of the axis and longs to the right, gains above and losses below. Each
 * row is a profit range from the node's last scan; bar length is the notional in it.
 */

import { useMemo, useState } from "react";

import { formatCompactUsd } from "@/lib/chart-format";
import type { MarketId } from "@/lib/engine/types";
import { densityRows } from "@/lib/house-bands";
import { feedProblem } from "@/lib/store/house-feed-text";
import { positionsFeed } from "@/lib/store/house-feeds";

import { useSession } from "../ConsoleProvider";
import { Pick } from "./Controls";
import { DataTable } from "./DataTable";
import { Panel, Quiet, Term } from "./Panel";
import { useFeed } from "./use-feed";
import { useMarketOptions } from "./use-markets";

/** The position map panel: clients' notional by side and by profit or loss in one market. */
export function PositionMap({ className }: { className?: string }) {
  const { store } = useSession();
  const markets = useMarketOptions();
  const [picked, setPicked] = useState<MarketId | null>(null);
  const market = picked !== null && markets.some((m) => m.id === picked) ? picked : (markets[0]?.id ?? null);
  const feed = useFeed(useMemo(() => (market === null ? null : positionsFeed(store, market)), [store, market]));
  const view = feed.data;
  const rows = useMemo(() => (view === null ? [] : densityRows(view)), [view]);
  const peak = Math.max(1, ...rows.flatMap((r) => [r.long, r.short]));
  return (
    <Panel
      title="Position map"
      tip="Clients' positions in the market by how far each is in profit or loss: shorts to the left, longs to the right, gains above the axis and losses below. Bar length is the notional in that range."
      className={className}
      controls={<Pick label="Position map market" value={market ?? 0} options={markets.map((m) => ({ value: m.id, label: m.label }))} onChange={setPicked} />}
    >
      {feed.status === "failed" ? (
        <Quiet>{feedProblem(feed, "positions by profit")}</Quiet>
      ) : feed.status === "unavailable" && view === null ? (
        <Quiet>This node does not report positions by profit yet.</Quiet>
      ) : feed.status === "waiting" && view === null ? (
        <Quiet>The node has not completed its first scan of accounts yet.</Quiet>
      ) : rows.length === 0 ? (
        <Quiet>{feed.status === "loading" ? "Reading the node's last scan…" : "No positions are open in this market."}</Quiet>
      ) : (
        <>
          <div className="flex justify-between text-label tracking-caps text-fg-3 uppercase">
            <Term label="Short" tip="Clients' short positions, to the left of the axis: they gain when the price falls." />
            <Term label="Long" tip="Clients' long positions, to the right of the axis: they gain when the price rises." />
          </div>
          <div className="relative">
          <ul aria-hidden="true" className="flex flex-col gap-px">
            {rows.map((row) => (
              <li key={row.label} className="grid grid-cols-[1fr_minmax(0,6.5rem)_1fr] items-center gap-1 text-label tabular-nums" title={`${row.label}: short ${formatCompactUsd(row.short)} (${row.shortCount}), long ${formatCompactUsd(row.long)} (${row.longCount})`}>
                <span className="flex h-2.5 justify-end"><span className="bg-ember/70" style={{ width: `${(row.short / peak) * 100}%` }} /></span>
                <span className="truncate text-center text-fg-3">{row.label}</span>
                <span className="flex h-2.5"><span className="bg-glow/70" style={{ width: `${(row.long / peak) * 100}%` }} /></span>
              </li>
            ))}
          </ul>
          <DataTable
            summary="Position map as a table"
            caption={`Notional by profit range, for ${view?.symbol ?? "the market"}`}
            columns={["Profit range", "Short", "Long"]}
            rows={rows.map((row) => ({ key: row.label, head: row.label, cells: [`${formatCompactUsd(row.short)}, ${row.shortCount} positions`, `${formatCompactUsd(row.long)}, ${row.longCount} positions`] }))}
          />
          </div>
          <p className="text-label text-fg-3">Gains at the top, losses at the bottom. The node&apos;s last scan; it holds no history.{feedProblem(feed, "positions by profit") === null ? "" : ` ${feedProblem(feed, "positions by profit")}`}</p>
        </>
      )}
    </Panel>
  );
}
