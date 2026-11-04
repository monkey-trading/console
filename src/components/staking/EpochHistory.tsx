"use client";

/**
 * Every closed distribution epoch, newest first (monkey-trading/console#279): when it closed, the
 * house NAV it measured against the floor, what went to stakers and how many, and every recipient of
 * the operator's share, from the node's signed `GET /v1/monkey/distributions`, with older epochs on
 * "Load more". The newest epochs are read again by themselves, and a failed read is made again too.
 */

import { useSyncExternalStore } from "react";

import { formatUsd, parseFixed } from "@/lib/fixed";
import { usdcFixed } from "@/lib/monkey/figures";
import type { EpochClose } from "@/lib/engine/staking-reads";
import type { EpochReads } from "@/lib/staking/epoch-reads";
import { formatStamp } from "@/lib/time";
import { formatUsdc } from "@/lib/vault";

import { Card, focusHeading } from "../monkey/Card";
import { ReadNote } from "../monkey/ReadNote";
import { NOTE } from "../monkey/styles";

const TITLE_ID = "epochs-title";
const TH = "px-1 py-1 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const TD = "px-1 py-1.5 align-top";
const LOAD = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:text-fg-3 lg:min-h-0";

/** USDC base units as the card shows them; a malformed amount, which a signed answer does not carry, shows a dash. */
const usdc = (units: string) => (/^\d+$/.test(units) ? formatUsdc(usdcFixed(BigInt(units))) : "—");

/** An engine `Fixed` in dollars. */
const usd = (fixed: string) => {
  const value = parseFixed(fixed);
  return value === null ? "—" : formatUsd(value);
};

/** `28 Oct 15:04`, in UTC. */
const when = (ms: number) => formatStamp(ms).slice(0, -3);

/** Every recipient of the epoch's operator share, named as the page names a candidate. */
function Shares({ close, labelOf }: { close: EpochClose; labelOf: (address: string) => string }) {
  if (close.operator_shares.length === 0) return <span className="text-fg-3">—</span>;
  return (
    <ul className="space-y-0.5">
      {close.operator_shares.map((share) => (
        <li key={share.account}><span title={share.account}>{labelOf(share.account)}</span>: {usdc(share.amount)}</li>
      ))}
    </ul>
  );
}

/** Where the node's record begins, which bounds what the list can show. */
function coverText(cover: NonNullable<ReturnType<EpochReads["getSnapshot"]>["cover"]>): string | null {
  if (cover.truncated) return `The node keeps the newest epochs only, from epoch ${cover.retained_from_epoch ?? "—"} on.`;
  if (!cover.from_genesis && cover.begins_ms !== null) return `The node's record of closes begins at ${formatStamp(cover.begins_ms)} UTC; earlier epochs are not listed.`;
  return null;
}

export function EpochHistory({ epochs, labelOf }: { epochs: EpochReads; labelOf: (address: string) => string }) {
  const state = useSyncExternalStore(epochs.subscribe, epochs.getSnapshot, epochs.getSnapshot);
  const covered = state.cover === null ? null : coverText(state.cover);
  const read = { status: state.status === "reading" || state.status === "idle" ? ("loading" as const) : state.status === "ready" ? ("ready" as const) : state.status, value: state.epochs.length > 0 ? state.epochs : null, message: state.error };
  const loadMore = () => {
    if (state.more) return;
    void epochs.loadMore().then(() => {
      if (epochs.getSnapshot().next === null) focusHeading(TITLE_ID);
    });
  };
  return (
    <Card id={TITLE_ID} title="Closed epochs">
      {state.status === "ready" && state.epochs.length === 0 && <p className={NOTE}>No distribution epoch has closed yet.</p>}
      {state.epochs.length > 0 && (
        <div role="region" aria-label="Closed distribution epochs" tabIndex={0} className="relative -mx-1 max-h-96 overflow-auto outline-none focus-visible:outline-2 focus-visible:outline-glow">
          <table className="w-full min-w-[36rem] text-label sm:text-caption">
            <caption className="sr-only">Each closed distribution epoch, newest first: when it closed, the house NAV against the floor, what went to stakers, and each recipient of the operator&apos;s share. Times are UTC.</caption>
            <thead className="sticky top-0 bg-ink-1">
              <tr>
                <th scope="col" className={TH}>Epoch</th>
                <th scope="col" className={TH}>Closed</th>
                <th scope="col" className={`${TH} text-right`}>NAV / floor</th>
                <th scope="col" className={`${TH} text-right`}>To stakers</th>
                <th scope="col" className={TH}>Operator&apos;s share</th>
              </tr>
            </thead>
            <tbody>
              {state.epochs.map((close) => (
                <tr key={close.epoch} className="border-t border-line">
                  <td className={`${TD} text-fg-2 tabular-nums`}>{close.epoch}{close.skipped !== null && <span className="block text-fg-3">after {close.skipped.first === close.skipped.last ? `epoch ${close.skipped.first}` : `epochs ${close.skipped.first}–${close.skipped.last}`}, unwitnessed</span>}</td>
                  <td className={`${TD} text-fg-2`}>{when(close.close_ms)}</td>
                  <td className={`${TD} text-right text-fg-2`}>{usd(close.nav)}<span className="block text-fg-3">{usd(close.floor)}</span></td>
                  <td className={`${TD} text-right text-fg`}>{usdc(close.stakers_usdc_units)}<span className="block text-fg-3">{close.stakers === 1 ? "1 staker" : `${close.stakers} stakers`}</span></td>
                  <td className={`${TD} break-words text-fg`}><Shares close={close} labelOf={labelOf} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state.status === "ready" && state.next !== null && <button type="button" aria-disabled={state.more} onClick={loadMore} className={LOAD}>{state.more ? "Loading" : "Load more"}<span className="sr-only"> epochs</span></button>}
      <ReadNote read={read} loading="Reading the closed epochs…" />
      {covered !== null && <p className={NOTE}>{covered}</p>}
      <p className={NOTE}>An epoch distributes what the house NAV holds above the floor: to stakers in proportion to their stake, and, while operator rotation is on, a fifth to the operators named here.</p>
    </Card>
  );
}
