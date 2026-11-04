"use client";

/**
 * The connected account's USDC distributions by epoch: what each closed epoch added to its
 * cumulative distribution, as a staker and, for an operator, as the operator, newest first, with
 * older epochs on "Load more". New epochs arrive from the stream; a failed read is made again by itself.
 */

import { useSyncExternalStore } from "react";

import { groupThousands } from "@/lib/format";
import { usdcFixed } from "@/lib/monkey/figures";
import { emptyHistoryText, epochsLeftOut, hasOperatorShare, MAX_EPOCHS, moreRemain, shownRows } from "@/lib/staking/distribution-history";
import type { DistributionHistoryReads } from "@/lib/staking/history-reads";
import { formatStamp } from "@/lib/time";
import { formatUsdc } from "@/lib/vault";

import { Card, focusHeading } from "../monkey/Card";
import { NOTE } from "../monkey/styles";
import { useConsoleSelect, usePanelState } from "../monkey/use-monkey";

const TITLE_ID = "history-title";
const TH = "px-1 py-1 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const LOAD = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:text-fg-3 aria-disabled:hover:border-line-2 aria-disabled:hover:text-fg-3 lg:min-h-0";

/** USDC base units as the card shows them; an epoch that paid the account nothing of a kind shows a dash. */
const usdc = (units: bigint | null) => (units === null ? "—" : formatUsdc(usdcFixed(units)));

/** `28 Oct 15:04`, in UTC, without the seconds the table has no room for. */
const when = (ms: number) => formatStamp(ms).slice(0, -3);

/** The card; `history` is the page's reads of it, which start and stop with the page. */
export function DistributionHistory({ history }: { history: DistributionHistoryReads }) {
  const state = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
  const account = useConsoleSelect((s) => s.wallet?.address ?? null);
  // The epochs are for the account they name: while another account's are held, none show.
  const mine = account !== null && state.account === account;
  const rows = mine ? shownRows(state.data) : [];
  // The account's distribution proof, which the USDC distributions card shows: an empty history must not contradict it.
  const { wallet: figures } = usePanelState();
  const proof = figures.address === account ? figures.proof.value : null;
  const entitled = proof === null || !/^\d+$/.test(proof.entitled) ? null : BigInt(proof.entitled);
  const operator = hasOperatorShare(rows);
  const more = mine && state.status === "ready" && moreRemain(state.data);
  const bounded = mine && epochsLeftOut(state.data);
  const error = (state.error ?? "the read failed").replace(/\.+$/, "");
  // The first read's failure, the newest pages' second read's, or Load more's: one status line that changes its words, so each is announced.
  const problem = !mine ? ""
    : state.status === "failed" ? `Could not read your distributions: ${error}. The read is made again by itself.`
      : state.recheckError !== null ? `Could not check for epochs the node had not listed yet: ${state.recheckError.replace(/\.+$/, "")}. The check is made again by itself.`
        : state.error !== null ? `Could not read older epochs: ${error}.` : "";
  const loadMore = () => {
    if (state.more) return;
    void history.loadMore().then(() => {
      // The button is gone once nothing older is left: its place is the card's heading.
      if (!moreRemain(history.getSnapshot().data)) focusHeading(TITLE_ID);
    });
  };
  return (
    <Card id={TITLE_ID} title="Your distributions">
      {account === null ? (
        <p className={NOTE}>Connect a wallet to see the USDC each epoch distributed to you.</p>
      ) : rows.length === 0 ? (
        !mine || state.status === "idle" || state.status === "reading" ? <p className={NOTE}>Reading your distributions by epoch…</p>
          : state.status === "failed" ? null
            : <p className={NOTE}>{emptyHistoryText(entitled)}</p>
      ) : (
        <div role="region" aria-label="Your distributions by epoch" tabIndex={0} className="relative -mx-1 max-h-80 overflow-y-auto outline-none focus-visible:outline-2 focus-visible:outline-glow">
          <table className="w-full table-fixed text-label sm:text-caption">
            <caption className="sr-only">USDC distributed to you by epoch, newest first. Times are UTC.</caption>
            <thead className="sticky top-0 bg-ink-1">
              <tr>
                <th scope="col" className={`${TH} w-[20%]`}>Epoch</th>
                <th scope="col" className={`${TH} w-[34%]`}>Closed</th>
                <th scope="col" className={`${TH} text-right`}>To you</th>
                {operator && <th scope="col" className={`${TH} text-right`}>Operator share</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.epoch} className="border-t border-line align-top">
                  <td className="px-1 py-1.5 text-fg-2 tabular-nums">{row.epoch}</td>
                  <td className="px-1 py-1.5 text-fg-2">{when(row.ts)}</td>
                  <td className="px-1 py-1.5 text-right break-words text-fg">{usdc(row.staker)}</td>
                  {operator && <td className="px-1 py-1.5 text-right break-words text-fg">{usdc(row.operator)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && <button type="button" aria-disabled={state.more} onClick={loadMore} className={LOAD}>{state.more ? "Loading" : "Load more"}<span className="sr-only"> epochs</span></button>}
      <p role="status" className="text-caption leading-relaxed text-amber empty:hidden">{problem}</p>
      {bounded && <p className={NOTE}>Only the newest {groupThousands(MAX_EPOCHS)} epochs are kept here.</p>}
    </Card>
  );
}
