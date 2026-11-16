"use client";

/**
 * The Rotation tab's table of turn assignments (monkey-trading/console#280), which its two turn cards
 * share: each assignment with its member, why it was named, when its key signs from and whether its
 * member took it.
 */

import { withAddress } from "@/lib/staking/operator-cells";
import { REASON_CELL, REASON_WORDS, type TurnRecord } from "@/lib/staking/rotation";
import { recordFrom, recordOutcome } from "@/lib/staking/rotation-words";

import { NOTE } from "../monkey/styles";

const TH = "px-1 py-1 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const TD = "px-1 py-1.5 align-top";

export interface Names {
  nameOf: (address: string) => string;
}

/**
 * The records' table: one row per assignment, the key a record's seq with its turn and position. `empty` is what the viewport says
 * with no record: it holds one height either way, so nothing below it moves when records land.
 */
export function TurnRecords({ records, caption, empty, nameOf }: { records: readonly TurnRecord[]; caption: string; empty: string } & Names) {
  return (
    <div role="region" aria-label={caption} tabIndex={0} className="-mx-1 h-72 overflow-auto outline-none focus-visible:outline-2 focus-visible:outline-glow">
      {records.length === 0 ? <p className={`${NOTE} px-1`}>{empty}</p> : <table className="w-full min-w-[40rem] text-label sm:text-caption">
        <caption className="sr-only">{caption} Times are UTC.</caption>
        <thead className="sticky top-0 bg-ink-1">
          <tr>
            <th scope="col" className={TH}>Turn</th>
            <th scope="col" className={TH}>Operator</th>
            <th scope="col" className={TH}>Chosen by</th>
            <th scope="col" className={TH}>Starts</th>
            <th scope="col" className={TH}>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={`${record.assignedSeq}:${record.turn}:${record.position}`} className="border-t border-line">
              <td className={`${TD} text-fg-2 tabular-nums`}>{record.turn}<span className="block text-fg-3">position {record.position + 1}</span></td>
              <td className={`${TD} break-all text-fg`}><span title={record.candidate}>{withAddress(nameOf(record.candidate), record.candidate)}</span></td>
              <td className={`${TD} text-fg-2`}><span title={REASON_WORDS[record.reason]}>{REASON_CELL[record.reason]}</span></td>
              <td className={`${TD} whitespace-nowrap text-fg-2`}>{recordFrom(record)}</td>
              <td className={`${TD} ${record.refused === null ? "text-fg-2" : "text-amber"}`}>{recordOutcome(record)}</td>
            </tr>
          ))}
        </tbody>
      </table>}
    </div>
  );
}
