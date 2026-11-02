"use client";

/** The panels that stay from the old page, in compact form: the exposure cap, market caps, parameters, checkpoints and withdrawal health. */

import { formatUsd } from "@/lib/fixed";
import { formatRate } from "@/lib/format";
import { capFor, paramsSource, utilBps } from "@/lib/house";
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
    <div role="meter" aria-label="Exposure against the cap" aria-valuemin={0} aria-valuemax={10_000} aria-valuenow={clamped} aria-valuetext={formatRate(bps)} className="h-2 w-full border border-line-2 bg-ink-2">
      <div className="h-full bg-glow" style={{ width: `${clamped / 100}%` }} />
    </div>
  );
}

/** What a panel fed by the node's house state says while it has nothing to show; `none` is the answer of a node that holds none. */
function unread(status: ConsoleState["houseStateStatus"], none: string): string {
  if (status === "unavailable") return "Not available: this node does not serve the house state yet.";
  return status === "pending" ? "Waiting for the node's answer." : none;
}

/** Gross exposure against the total cap. */
export function CapPanel() {
  const { nav, gross, params, status } = useSelected(selectCap);
  const totalCap = params === null ? null : capFor(nav, params.totalCapBps, params.totalCapFloor);
  const used = totalCap === null ? null : utilBps(gross, totalCap);
  return (
    <Panel title="Exposure against the cap" tip="The house's gross exposure as a share of the cap on it: the larger of a share of NAV and a dollar floor.">
      {params === null ? (
        <Quiet>{unread(status, "The cap's parameters have not been set in the log yet.")}</Quiet>
      ) : used === null || totalCap === null ? (
        <p className={NOTE}>The cap is not positive at the current net asset value, so no utilisation can be stated.</p>
      ) : (
        <>
          <Meter bps={used} />
          <p aria-hidden="true" className="text-caption text-fg-2">{formatRate(used)} of a {formatUsd(totalCap)} cap</p>
          <p className="sr-only">Exposure is {formatRate(used)} of a {formatUsd(totalCap)} cap at the current net asset value, refreshed from the node&apos;s signed answers.</p>
          <p className={NOTE}>The cap is the larger of {formatRate(params.totalCapBps)} of net asset value and a {formatUsd(params.totalCapFloor)} floor.</p>
        </>
      )}
    </Panel>
  );
}

/** Each market's cap and the exposure against it. */
export function MarketCaps() {
  const { nav, rows } = useSelected(selectRows);
  return (
    <Panel title="Market caps" tip="Each market's cap is the larger of its share of the house's NAV and its dollar floor; the table also shows the house's net exposure in the market at the node's last scan.">
      <HouseCaps rows={rows} nav={nav} />
    </Panel>
  );
}

/** The profit fee and close-out level in force. */
export function Parameters() {
  const { params, status } = useSelected(selectParams);
  const simulated = useSession().store.deps.client.signatures === "none";
  const source = params === null ? null : paramsSource(params, simulated);
  return (
    <Panel title="Parameters" tip="The profit fee and close-out level the operator may move within half of their launch values, only after a public notice of at least seven days.">
      {params === null ? (
        <Quiet>{unread(status, "No parameters have been set in the log yet.")}</Quiet>
      ) : (
        <>
          <dl className="space-y-1">
            <Row label="Profit fee" tip="The share of a winning trade's realised profit the house keeps." value={formatRate(params.profitFeeBps)} />
            <Row label="Close-out level" tip="The share of an account's margin requirement below which its positions close." value={`${formatRate(params.closeoutLevelBps)} of margin`} />
          </dl>
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
    <Panel title="Checkpoints" tip="The enclave signs a root of its state as it sequences commands and posts it in the public log. Anyone may replay the log to a checkpoint's sequence and check its root.">
      {checkpoint === null ? (
        <Quiet>{unread(status, "The log holds no checkpoint yet.")}</Quiet>
      ) : (
        <>
          <dl className="space-y-1">
            <Row label="Latest checkpoint" tip="The log sequence number the latest posted root covers." value={`seq ${checkpoint.seq}`} />
            <div className="space-y-0.5">
              <dt className="text-caption text-fg-3"><Term label="State root" tip="The keccak-256 root of the engine's state at that sequence number. Replay the public log to it and compare." /></dt>
              <dd className="text-data break-all text-fg">{checkpoint.root}</dd>
            </div>
          </dl>
          {signatures === "none" && <p className={NOTE}>This build runs the in-browser simulation: it signs nothing, and the roots here are the mock&apos;s stand-ins.</p>}
        </>
      )}
    </Panel>
  );
}

/** What is owed in the queue, and how the figures were read. */
export function WithdrawalHealth() {
  const { totals, failed } = useSelected(selectQueue);
  return (
    <Panel title="Withdrawal health" tip="Withdrawals are paid in the order asked, each up to the collateral the vault holds; one it cannot cover yet waits in a public first-in first-out queue.">
      <dl className="space-y-1">
        <Row label="Requests waiting" tip="How many requests wait in the queue." value={totals === null ? "—" : String(totals.count)} />
        <Row label="Queued" tip="What the queue still owes, in dollars." value={totals === null ? "—" : formatUsd(totals.remaining)} />
      </dl>
      {totals === null && <p className={NOTE}>The queue&apos;s size is read from the node&apos;s signed answers; that read {failed ? "keeps failing." : "has not finished."}</p>}
      <p className={NOTE}>The node signs no flag that pauses withdrawals: custody-side pauses are the vault contract&apos;s own state, on chain, outside the node&apos;s signed answers.</p>
    </Panel>
  );
}
