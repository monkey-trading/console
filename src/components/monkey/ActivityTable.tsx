"use client";

/** The latest MONKEY events: loss allocations, stakes and unstakes, newest first. */

import { formatMonkeyFigure, shortHex } from "@/lib/format";
import type { ActivityKind } from "@/lib/engine/stats-types";
import { ACTIVITY_LIMIT } from "@/lib/monkey/panel";
import { formatStamp } from "@/lib/time";

import { Card } from "./Card";
import { ReadNote } from "./ReadNote";
import { NOTE } from "./styles";
import { usePanelState } from "./use-monkey";

const LABELS: Record<ActivityKind, string> = { loss_close: "Loss close", stake: "Stake", unstake: "Unstake" };
const TONES: Record<ActivityKind, string> = {
  loss_close: "border-ember/40 text-ember",
  stake: "border-glow/40 text-glow",
  unstake: "border-line-2 text-fg-2",
};

/** `28 Oct 15:04`, in UTC, without the seconds the table has no room for. */
function when(ms: number): string {
  return formatStamp(ms).slice(0, -3);
}

export function ActivityTable() {
  const { activity } = usePanelState();
  const page = activity.value;
  return (
    <Card id="activity-title" title="MONKEY activity" aside={<span className="text-label tracking-caps text-fg-3 uppercase">Last {ACTIVITY_LIMIT}</span>}>
      {page === null ? (
        <ReadNote read={activity} loading="Reading the latest activity…" />
      ) : page.entries.length === 0 ? (
        <p className={NOTE}>No MONKEY activity has been recorded yet.</p>
      ) : (
        <div className="-mx-1">
          <table className="w-full table-fixed text-label sm:text-caption">
            <caption className="sr-only">The latest {page.entries.length} MONKEY events, newest first. Times are UTC and amounts are in MONKEY.</caption>
            <thead>
              <tr className="text-left text-label tracking-caps text-fg-3 uppercase">
                <th scope="col" className="w-[26%] px-1 py-1 font-normal">Time</th>
                <th scope="col" className="w-[24%] px-1 py-1 font-normal">Type</th>
                <th scope="col" className="w-[26%] px-1 py-1 font-normal">Account</th>
                <th scope="col" className="px-1 py-1 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {page.entries.map((entry) => (
                <tr key={entry.id} className="border-t border-line align-top">
                  <td className="px-1 py-1.5 text-fg-2">{when(entry.ts)}</td>
                  <td className="px-1 py-1.5"><span className={`inline-block rounded border px-1 text-label uppercase ${TONES[entry.type]}`}>{LABELS[entry.type]}</span></td>
                  <td className="px-1 py-1.5 text-fg-2" title={entry.account}>{shortHex(entry.account, 4, 4)}</td>
                  <td className="px-1 py-1.5 text-right break-words text-fg">{formatMonkeyFigure(BigInt(entry.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page !== null && <ReadNote read={activity} />}
      {page !== null && page.truncated && <p className={NOTE}>The node keeps only the newest events; older ones have been dropped.</p>}
    </Card>
  );
}
