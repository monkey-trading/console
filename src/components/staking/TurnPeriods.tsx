/** The Rotation tab's record of who ran the trading server and when (monkey-trading/console#435): each operator from its takeover to the next, newest first. */

import { REASON_WORDS } from "@/lib/staking/rotation";
import { keptLine, periodEnd, TAKEOVER_CELL, type TurnPeriod } from "@/lib/staking/turn-periods";
import { formatStamp } from "@/lib/time";

import { NOTE } from "../monkey/styles";
import { TurnOperator } from "./TurnOperator";

const TH = "px-1 py-1 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const TD = "px-1 py-1.5 align-top";
const CAPTION = "Each operator that ran the trading server, newest first, from its takeover until the next operator took over, with how it took over.";

/** The periods in a viewport of one height, so nothing below moves when they land. */
export function TurnPeriods({ periods, empty, nameOf }: { periods: readonly TurnPeriod[]; empty: string; nameOf: (address: string) => string }) {
  return (
    <div role="region" aria-label={CAPTION} tabIndex={0} className="-mx-1 h-60 overflow-auto outline-none focus-visible:outline-2 focus-visible:outline-glow">
      {periods.length === 0 ? <p className={`${NOTE} px-1`}>{empty}</p> : <table className="w-full min-w-[34rem] text-label sm:text-caption">
        <caption className="sr-only">{CAPTION} Times are UTC.</caption>
        <thead className="sticky top-0 bg-ink-1">
          <tr>
            <th scope="col" className={TH}>From</th>
            <th scope="col" className={TH}>Until</th>
            <th scope="col" className={TH}>Operator</th>
            <th scope="col" className={TH}>How it took over</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={`${period.record.assignedSeq}:${period.record.turn}:${period.record.position}`} className="border-t border-line">
              <td className={`${TD} whitespace-nowrap text-fg-2 tabular-nums`}>
                {formatStamp(period.fromMs)}
                {period.record.reason === "draw" && period.record.appliesAtMs !== null && <span className="block text-fg-3">Scheduled for {formatStamp(period.record.appliesAtMs)}</span>}
              </td>
              <td className={`${TD} whitespace-nowrap tabular-nums ${period.toMs === null ? "text-fg" : "text-fg-2"}`}>{periodEnd(period)}</td>
              <td className={`${TD} break-all text-fg`}><TurnOperator candidate={period.record.candidate} adminKey={period.record.adminKey} nameOf={nameOf} /></td>
              <td className={`${TD} text-fg-2`}>
                <span title={REASON_WORDS[period.record.reason]}>{TAKEOVER_CELL[period.record.reason]}</span>
                {period.kept.map((turn) => <span key={turn.atMs} className="mt-1 block text-fg-3">{keptLine(turn)}</span>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>}
    </div>
  );
}
