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
  if (status === "unavailable") return "These figures aren't available from this server yet.";
  if (status === "failed") return "Couldn't load these figures. Trying again automatically.";
  return status === "pending" ? "Loading…" : none;
}

/** Gross exposure against the total cap. */
export function CapPanel() {
  const { nav, gross, params, status } = useSelected(selectCap);
  const totalCap = params === null ? null : capFor(nav, params.totalCapBps, params.totalCapFloor);
  const used = totalCap === null ? null : utilBps(gross, totalCap);
  return (
    <Panel title="Total exposure limit" tip="This is how much of its total exposure limit the house is using. The limit is a share of the house value, with a dollar minimum.">
      {params === null ? (
        <Quiet>{unread(status, "The limit hasn't been set yet.")}</Quiet>
      ) : used === null || totalCap === null ? (
        <p className={NOTE}>The limit is zero at the current house value, so there&apos;s no usage to show.</p>
      ) : (
        <>
          <Meter bps={used} />
          <p aria-hidden="true" className="text-caption text-fg-2">{formatRate(used)} of a {formatUsd(totalCap)} limit</p>
          <p className="sr-only">Exposure is {formatRate(used)} of a {formatUsd(totalCap)} limit at the current house value.</p>
          <p className={NOTE}>The limit is {formatRate(params.totalCapBps)} of the house value, or {formatUsd(params.totalCapFloor)} if that&apos;s higher.</p>
        </>
      )}
    </Panel>
  );
}

/** Each market's cap and the exposure against it. */
export function MarketCaps() {
  const { nav, rows } = useSelected(selectRows);
  return (
    <Panel title="Market limits" tip="Each market's limit is a share of the house value, with a dollar minimum. The table also shows the house's net exposure in each market as of the last update.">
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
    <Panel title="Trading terms" tip="The operator can change these only after at least 7 days' public notice. The profit fee can never go below its launch rates, and its base rate can rise by at most half. The close-out level can move by up to half its launch value.">
      {params === null ? (
        <Quiet>{unread(status, "These terms haven't been set yet.")}</Quiet>
      ) : (
        <>
          <dl className="space-y-1">
            <Row label="Profit fee" tip="This is the share of your profit the house keeps when you close a winning trade. It's the higher of the base rate and the rate for how long you held the position." value={`${formatRate(params.profitFeeBps)} base`} />
            <Row label="Close-out level" tip="Your positions are closed out when your equity falls below this share of your margin." value={`${formatRate(params.closeoutLevelBps)} of margin`} />
          </dl>
          <p className={NOTE}>{describeSchedule(params)}</p>
          {params.profitFeeCurve.length > 0 && (
            <table className="w-full text-caption">
              <caption className="sr-only">The profit fee by how long the position was held, changing evenly between the times shown</caption>
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
    <Panel title="Checkpoints" tip="The server regularly records a fingerprint of its whole state in its public log. Anyone can replay the log to check that the fingerprint matches.">
      {checkpoint === null ? (
        <Quiet>{unread(status, "No checkpoint has been recorded yet.")}</Quiet>
      ) : (
        <>
          <dl className="space-y-1">
            <Row label="Latest checkpoint" tip="This is the number of the log entry the latest checkpoint covers." value={`Entry ${checkpoint.seq}`} />
            <div className="space-y-0.5">
              <dt className="text-caption text-fg-3"><Term label="State fingerprint" tip="This is the fingerprint of the server's state at that log entry. Replay the public log up to that entry and compare." /></dt>
              <dd className="text-data break-all text-fg">{checkpoint.root}</dd>
            </div>
          </dl>
          {signatures === "none" && <p className={NOTE}>This is a demo, so these checkpoints are simulated.</p>}
        </>
      )}
    </Panel>
  );
}

/** What is owed in the queue, and how the figures were read. */
export function WithdrawalHealth() {
  const { totals, failed } = useSelected(selectQueue);
  return (
    <Panel title="Withdrawal health" tip="Withdrawals are paid in the order they were requested. One that can't be paid straight away waits in a public queue until funds are available.">
      <dl className="space-y-1">
        <Row label="Requests waiting" tip="This is the number of withdrawal requests waiting." value={totals === null ? "—" : String(totals.count)} />
        <Row label="Queued" tip="This is what's still owed to everyone in the queue, in dollars." value={totals === null ? "—" : formatUsd(totals.remaining)} />
      </dl>
      {totals === null ? <p className={NOTE}>{failed ? "Couldn't load the queue. Trying again automatically." : "Loading the queue…"}</p> : queueCaveats(totals, failed).map((line) => <p key={line} className={NOTE}>{line}</p>)}
      <p className={NOTE}>This page can&apos;t show whether the on-chain vault that holds deposits has paused withdrawals. The server doesn&apos;t report it.</p>
    </Panel>
  );
}
