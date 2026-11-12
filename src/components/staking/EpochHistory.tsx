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
import { EPOCH_PAGE, type EpochReads } from "@/lib/staking/epoch-reads";
import { coverText, problemText, unavailableText } from "@/lib/staking/epoch-words";
import { withAddress } from "@/lib/staking/operator-cells";
import { formatStampWithYear } from "@/lib/time";
import { formatUsdc } from "@/lib/vault";

import { Card, focusHeading } from "../monkey/Card";
import { ReadNote } from "../monkey/ReadNote";
import { NOTE } from "../monkey/styles";

const TITLE_ID = "epochs-title";
const TH = "px-1 py-1 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const TD = "px-1 py-1.5 align-top";
const LOAD = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:text-fg-3 lg:min-h-0";

/** The rows the first page holds below its reading row, kept unseen so the card keeps its loaded shape while the first read runs. */
const HELD_ROWS = Array.from({ length: EPOCH_PAGE - 1 }, (_, index) => index);

/** USDC base units as the card shows them; a malformed amount, which a signed answer does not carry, shows a dash. */
const usdc = (units: string) => (/^\d+$/.test(units) ? formatUsdc(usdcFixed(BigInt(units))) : "—");

/** An engine `Fixed` in dollars. */
const usd = (fixed: string) => {
  const value = parseFixed(fixed);
  return value === null ? "—" : formatUsd(value);
};


/** The table's head, the same while it is read and once it is. */
function Head() {
  return (
    <thead className="sticky top-0 bg-ink-1">
      <tr>
        <th scope="col" className={TH}>Epoch</th>
        <th scope="col" className={TH}>Closed</th>
        <th scope="col" className={`${TH} text-right`}>NAV / floor</th>
        <th scope="col" className={`${TH} text-right`}>To stakers</th>
        <th scope="col" className={TH}>Operator&apos;s share</th>
      </tr>
    </thead>
  );
}


/** Every recipient of the epoch's operator share, named as the page names a candidate. */
function Shares({ close, labelOf }: { close: EpochClose; labelOf: (address: string) => string }) {
  if (close.operator_shares.length === 0) return <span className="text-fg-3">—</span>;
  return (
    <ul className="space-y-0.5">
      {close.operator_shares.map((share) => (
        <li key={share.account}><span title={share.account}>{withAddress(labelOf(share.account), share.account)}</span>: {usdc(share.amount)}</li>
      ))}
    </ul>
  );
}

/** The card; `epochs` is the section's reads of it, which start and stop with its tabs and keep what they read across a tab switch; `labelOf` names an operator's share's recipient. */
export function EpochHistory({ epochs, labelOf }: { epochs: EpochReads; labelOf: (address: string) => string }) {
  const state = useSyncExternalStore(epochs.subscribe, epochs.getSnapshot, epochs.getSnapshot);
  const covered = state.cover === null ? null : coverText(state.cover);
  const read = { status: state.status === "reading" || state.status === "idle" ? ("loading" as const) : state.status === "ready" ? ("ready" as const) : state.status, value: state.epochs.length > 0 ? state.epochs : null, message: state.error };
  const problem = problemText(state);
  const gone = unavailableText(state);
  const loadMore = () => {
    if (state.more) return;
    void epochs.loadMore().then(() => {
      if (epochs.getSnapshot().next === null) focusHeading(TITLE_ID);
    });
  };
  // The first read holds the table's shape, so the charts below stay in place when the page lands.
  const firstRead = state.epochs.length === 0 && (state.status === "reading" || state.status === "idle");
  const more = state.status === "ready" && state.next !== null;
  return (
    <Card id={TITLE_ID} title="Closed epochs">
      {/* One viewport at the same height in every state — reading, empty, failed, or holding any
          number of epochs — so the charts below the card never move; the empty and failure lines
          sit inside it. */}
      <div role="region" aria-label="Closed distribution epochs" tabIndex={0} className="relative -mx-1 h-96 overflow-auto outline-none focus-visible:outline-2 focus-visible:outline-glow">
        {gone !== "" && <p role="status" className={`${NOTE} px-1 pb-1`}>{gone}</p>}
        {state.epochs.length > 0 ? (
          <table className="w-full min-w-[36rem] text-label sm:text-caption">
            <caption className="sr-only">Each closed distribution epoch, newest first: when it closed, the house NAV against the floor, what went to stakers, and each recipient of the operator&apos;s share. Times are UTC.</caption>
            <Head />
            <tbody>
              {state.epochs.map((close) => (
                <tr key={close.epoch} className="border-t border-line">
                  <td className={`${TD} text-fg-2 tabular-nums`}>{close.epoch}{close.skipped !== null && <span className="block text-fg-3">{close.skipped.first === close.skipped.last ? `epoch ${close.skipped.first} closed` : `epochs ${close.skipped.first}–${close.skipped.last} closed`} with no distribution</span>}</td>
                  <td className={`${TD} text-fg-2`}>{formatStampWithYear(close.close_ms)}</td>
                  <td className={`${TD} text-right text-fg-2`}>{usd(close.nav)}<span className="block text-fg-3">{usd(close.floor)}</span></td>
                  <td className={`${TD} text-right text-fg`}>{usdc(close.stakers_usdc_units)}<span className="block text-fg-3">{close.stakers === 1 ? "1 staker" : `${close.stakers} stakers`}</span></td>
                  <td className={`${TD} break-words text-fg`}><Shares close={close} labelOf={labelOf} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : firstRead ? (
          <table className="w-full min-w-[36rem] text-label sm:text-caption">
            <caption className="sr-only">Each closed distribution epoch, being read.</caption>
            <Head />
            <tbody>
              <tr className="border-t border-line"><td colSpan={5} className={`${TD} text-fg-3`}>Reading the closed epochs…</td></tr>
              {HELD_ROWS.map((index) => (
                <tr key={index} aria-hidden="true" className="invisible border-t border-line align-top">
                  <td className={`${TD} tabular-nums`}>—</td>
                  <td className={TD}>—</td>
                  <td className={`${TD} text-right`}>—<span className="block">—</span></td>
                  <td className={`${TD} text-right`}>—<span className="block">—</span></td>
                  <td className={TD}>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : state.status === "ready" ? (
          <p className={`${NOTE} px-1`}>No distribution epoch has closed yet.</p>
        ) : (
          <ReadNote read={read} loading="Reading the closed epochs…" />
        )}
      </div>
      {/* The Load more row and the cover line hold their places in every state, so nothing below
          the card moves when a read lands. */}
      {more ? (
        <button type="button" aria-disabled={state.more} onClick={loadMore} className={LOAD}>{state.more ? "Loading" : "Load more"}<span className="sr-only"> epochs</span></button>
      ) : (
        <span aria-hidden="true" className={`${LOAD} block invisible`}>Load more</span>
      )}
      <p role="status" className="text-caption leading-relaxed text-amber empty:hidden">{problem}</p>
      {covered !== null ? <p className={NOTE}>{covered}</p> : <p aria-hidden="true" className={`${NOTE} invisible`}>{"\u00a0"}</p>}
      <p className={NOTE}>Each close distributes the excess as the Distribution card describes; the operator&apos;s fifth, while rotation is on, is named in the last column.</p>
    </Card>
  );
}
