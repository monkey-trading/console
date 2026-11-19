"use client";

/** The panels that stay from the old page, in compact form: the exposure cap, market caps, parameters, checkpoints and withdrawal health. */

import { describeSchedule, formatCurveHold } from "@/lib/fee-words";
import { formatUsd } from "@/lib/fixed";
import { formatRate } from "@/lib/format";
import { capFor, paramsSource, queueCaveats, utilBps } from "@/lib/house";
import type { ConsoleState } from "@/lib/store/state";

import { useSession } from "../ConsoleProvider";
import { HouseCaps, type CapRow } from "../HouseCaps";
import { Panel, Quiet, Row, Term } from "./Panel";
import { useSelected } from "./use-feed";

const NOTE = "text-label leading-relaxed text-fg-3";

const selectCap = (s: ConsoleState) => ({ nav: s.house.nav, gross: s.house.grossExposure, params: s.houseParams, status: s.houseStateStatus });
const selectRows = (s: ConsoleState): { nav: bigint; rows: CapRow[] } => ({
  nav: s.house.nav,
  rows: s.markets.map((m) => ({ id: m.id, symbol: m.symbol, bps: m.view.house_cap_bps, floor: m.view.house_cap_floor, net: s.house.scan?.markets.find((row) => row.market === m.id)?.net ?? null })),
});
const selectParams = (s: ConsoleState) => ({ params: s.houseParams, status: s.houseStateStatus });
const selectCheckpoint = (s: ConsoleState) => ({ checkpoint: s.checkpoint, status: s.houseStateStatus });
const selectQueue = (s: ConsoleState) => ({ totals: s.withdrawalTotals, failed: s.queueFailed });

/** The utilisation bar for a share of a cap; the geometry clamps, the announced value does not. */
function Meter({ bps }: { bps: number }) {
  const clamped = Math.min(10_000, Math.max(0, bps));
  return (
    <div role="meter" aria-label="Exposure against the limit" aria-valuemin={0} aria-valuemax={10_000} aria-valuenow={clamped} aria-valuetext={formatRate(bps)} className="h-2 w-full border border-line-2 bg-ink-2">
      <div className="h-full bg-glow" style={{ width: `${clamped / 100}%` }} />
    </div>
  );
}

/** What a panel fed by the node's house state says while it has nothing to show; `none` is the answer of a node that holds none. */
function unread(status: ConsoleState["houseStateStatus"], none: string): string {
  if (status === "unavailable") return "These figures are not yet available from this trading server.";
  if (status === "failed") return "These figures could not be loaded. The app will try again automatically.";
  return status === "pending" ? "Loading…" : none;
}

/** Gross exposure against the total cap. */
export function CapPanel() {
  const { nav, gross, params, status } = useSelected(selectCap);
  const totalCap = params === null ? null : capFor(nav, params.totalCapBps, params.totalCapFloor);
  const used = totalCap === null ? null : utilBps(gross, totalCap);
  return (
    <Panel title="Total exposure limit" tip="The share of its total exposure limit that the house is currently using. The limit is a set percentage of the house value, or a fixed dollar minimum if that is higher.">
      {params === null ? (
        <Quiet>{unread(status, "The total exposure limit has not yet been set.")}</Quiet>
      ) : used === null || totalCap === null ? (
        <p className={NOTE}>The limit is zero at the current house value, so no usage can be shown.</p>
      ) : (
        <>
          <Meter bps={used} />
          <p aria-hidden="true" className="text-caption text-fg-2">{formatRate(used)} of a {formatUsd(totalCap)} limit</p>
          <p className="sr-only">Exposure is {formatRate(used)} of a {formatUsd(totalCap)} limit at the current house value.</p>
          <p className={NOTE}>The limit is {formatRate(params.totalCapBps)} of the house value, or {formatUsd(params.totalCapFloor)} if that amount is higher.</p>
        </>
      )}
    </Panel>
  );
}

/** Each market's cap and the exposure against it. */
export function MarketCaps() {
  const { nav, rows } = useSelected(selectRows);
  return (
    <Panel title="Market limits" tip="Each market has its own exposure limit, which is a set percentage of the house value or a fixed dollar minimum, whichever is higher. The table also shows the house's net exposure in each market as at the most recent update.">
      <HouseCaps rows={rows} nav={nav} />
    </Panel>
  );
}

/** The profit fee's schedule and the close-out level in force. */
export function Parameters() {
  const { params, status } = useSelected(selectParams);
  const simulated = useSession().store.deps.client.signatures === "none";
  const source = params === null ? null : paramsSource(params, simulated);
  return (
    <Panel title="Trading terms" tip="Changes to these terms take effect after at least seven days' public notice. The only exception is a temporary rise in the close-out level, which the operators can approve at once to reduce risk.">
      {params === null ? (
        <Quiet>{unread(status, "The trading terms have not yet been set.")}</Quiet>
      ) : (
        <>
          <dl className="space-y-1">
            <Row label="Profit fee" tip="The fee charged on the realised profit of a winning trade, as a percentage of that profit. The rate applied is the higher of the base rate and the rate for the length of time the position was held." value={`${formatRate(params.profitFeeBps)} base`} />
            <Row label="Close-out level" tip="The close-out level is a percentage of your margin requirement. If your equity falls below that level, your positions are closed out." value={`${formatRate(params.closeoutLevelBps)} of margin`} />
          </dl>
          <p className={NOTE}>{describeSchedule(params)}</p>
          {params.profitFeeCurve.length > 0 && (
            <table className="w-full text-caption">
              <caption className="sr-only">The profit fee rate by holding time, which changes linearly between the times shown</caption>
              <thead><tr className="text-label text-fg-3"><th scope="col" className="py-0.5 text-left font-normal">Held</th><th scope="col" className="py-0.5 text-right font-normal">Fee</th></tr></thead>
              <tbody>
                {params.profitFeeCurve.map((point) => <tr key={point.hold_ms}><td className="py-0.5 text-fg-2">{formatCurveHold(point.hold_ms)}</td><td className="py-0.5 text-right tabular-nums">{formatRate(point.fee_bps)}</td></tr>)}
              </tbody>
            </table>
          )}
          {source !== null && <p className={NOTE}>{source}</p>}
        </>
      )}
    </Panel>
  );
}

/** The latest signed state root. */
export function Checkpoints() {
  const { signatures } = useSession().store.deps.client;
  const { checkpoint, status } = useSelected(selectCheckpoint);
  return (
    <Panel title="Snapshots" tip="At regular intervals, the trading server records a fingerprint of its entire state in its public log. Anyone can replay the log independently to confirm that each fingerprint matches.">
      {checkpoint === null ? (
        <Quiet>{unread(status, "No snapshot has been recorded yet.")}</Quiet>
      ) : (
        <>
          <dl className="space-y-1">
            <Row label="Latest snapshot" tip="The latest snapshot, identified by the number of the public log entry it covers. Elsewhere in the app, a snapshot is referred to by this number." value={`Log entry ${checkpoint.seq}`} />
            <div className="space-y-0.5">
              <dt className="text-caption text-fg-3"><Term label="State fingerprint" tip="The fingerprint of the server's state at that log entry. You can verify it by replaying the public log up to the same entry and comparing the result." /></dt>
              <dd className="text-data break-all text-fg">{checkpoint.root}</dd>
            </div>
          </dl>
          {signatures === "none" && <p className={NOTE}>This is a demo, so these snapshots are simulated.</p>}
        </>
      )}
    </Panel>
  );
}

/** What is owed in the queue, and how the figures were read. */
export function WithdrawalHealth() {
  const { totals, failed } = useSelected(selectQueue);
  return (
    <Panel title="Withdrawal health" tip="Withdrawals are paid in the order in which they were requested. A withdrawal that cannot be paid immediately waits in a public queue until funds become available.">
      <dl className="space-y-1">
        <Row label="Requests waiting" tip="The number of withdrawal requests waiting in the queue." value={totals === null ? "—" : String(totals.count)} />
        <Row label="Queued" tip="The total amount still owed to everyone in the withdrawal queue, in US dollars." value={totals === null ? "—" : formatUsd(totals.remaining)} />
      </dl>
      {totals === null ? <p className={NOTE}>{failed ? "The withdrawal queue could not be loaded. The app will try again automatically." : "Loading the withdrawal queue…"}</p> : queueCaveats(totals, failed).map((line) => <p key={line} className={NOTE}>{line}</p>)}
      <p className={NOTE}>The trading server does not report whether the on-chain vault that holds deposits has paused withdrawals, so this page cannot show it.</p>
    </Panel>
  );
}
