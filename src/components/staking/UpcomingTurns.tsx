/** The Rotation tab's turns drawn but not yet taken over (monkey-trading/console#435), soonest first, each with its scheduled start. */

import { REASON_CELL, REASON_WORDS, turnStartMs, type TurnRecord } from "@/lib/staking/rotation";
import { upcomingStatus } from "@/lib/staking/turn-periods";
import { formatStamp } from "@/lib/time";

import { NOTE } from "../monkey/styles";
import { TurnOperator } from "./TurnOperator";

const TH = "px-1 py-1 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const TD = "px-1 py-1.5 align-top";
const CAPTION = "Turns drawn but not yet taken over, soonest first, with each operator, how it was chosen and its scheduled start.";

/** The upcoming turns in a viewport of one height, so nothing below moves when they land. */
export function UpcomingTurns({ upcoming, empty, nowMs, nameOf }: { upcoming: readonly TurnRecord[]; empty: string; nowMs: number; nameOf: (address: string) => string }) {
  return (
    <div role="region" aria-label={CAPTION} tabIndex={0} className="-mx-1 h-28 overflow-auto outline-none focus-visible:outline-2 focus-visible:outline-glow">
      {upcoming.length === 0 ? <p className={`${NOTE} px-1`}>{empty}</p> : <table className="w-full min-w-[34rem] text-label sm:text-caption">
        <caption className="sr-only">{CAPTION} Times are UTC.</caption>
        <thead className="sticky top-0 bg-ink-1">
          <tr>
            <th scope="col" className={TH}>Scheduled start</th>
            <th scope="col" className={TH}>Operator</th>
            <th scope="col" className={TH}>Chosen by</th>
            <th scope="col" className={TH}>Status</th>
          </tr>
        </thead>
        <tbody>
          {upcoming.map((record) => (
            <tr key={`${record.assignedSeq}:${record.turn}:${record.position}`} className="border-t border-line">
              <td className={`${TD} whitespace-nowrap text-fg-2 tabular-nums`}>{formatStamp(turnStartMs(record))}</td>
              <td className={`${TD} break-all text-fg`}><TurnOperator candidate={record.candidate} adminKey={record.adminKey} nameOf={nameOf} /></td>
              <td className={`${TD} text-fg-2`}><span title={REASON_WORDS[record.reason]}>{REASON_CELL[record.reason]}</span></td>
              <td className={`${TD} text-fg-2`}>{upcomingStatus(record, nowMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>}
    </div>
  );
}
