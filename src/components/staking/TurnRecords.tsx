"use client";

/**
 * The Rotation tab's turn cards (monkey-trading/console#280): the skips and promotions among the
 * turns read, and the turn history, newest first, each assignment with its member, why it was named,
 * when its key signs from and whether its member took it, with older turns on "Load older".
 */

import { withAddress } from "@/lib/staking/operator-cells";
import { isReassignment, REASON_CELL, REASON_WORDS, type TurnRecord } from "@/lib/staking/rotation";
import { recordFrom, recordOutcome } from "@/lib/staking/rotation-words";

import { Card } from "../monkey/Card";
import { NOTE, TOGGLE } from "../monkey/styles";

const TH = "px-1 py-1 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const TD = "px-1 py-1.5 align-top";

interface Names {
  nameOf: (address: string) => string;
}

/** The records' table: one row per assignment, the key a record's seq with its turn and position. */
function Records({ records, caption, nameOf }: { records: readonly TurnRecord[]; caption: string } & Names) {
  return (
    <div role="region" aria-label={caption} tabIndex={0} className="-mx-1 max-h-96 overflow-auto outline-none focus-visible:outline-2 focus-visible:outline-glow">
      <table className="w-full min-w-[40rem] text-label sm:text-caption">
        <caption className="sr-only">{caption} Times are UTC.</caption>
        <thead className="sticky top-0 bg-ink-1">
          <tr>
            <th scope="col" className={TH}>Turn</th>
            <th scope="col" className={TH}>Member</th>
            <th scope="col" className={TH}>Named by</th>
            <th scope="col" className={TH}>Signs from</th>
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
      </table>
    </div>
  );
}

/** The skips, promotions and refused assignments among the records read. */
export function Reassignments({ records, nameOf }: { records: readonly TurnRecord[] } & Names) {
  const moved = records.filter(isReassignment);
  return (
    <Card id="rotation-moves-title" title="Skips and promotions">
      {moved.length === 0 ? (
        <p className={NOTE}>No turn among those read was skipped, promoted or refused.</p>
      ) : (
        <Records records={moved} caption="Turns reassigned by a skip or a promotion, or refused, newest first." nameOf={nameOf} />
      )}
      <p className={NOTE}>A skip names the next member in the turn&apos;s order when the one before it did not take the turn in time. A promotion moves the turn from a failed member by the liveness rule. A refused assignment changes nothing: the key in effect stays.</p>
    </Card>
  );
}

interface HistoryProps extends Names {
  records: readonly TurnRecord[];
  /** Whether older turns can be read. */
  more: boolean;
  /** Whether the node dropped older turns for room. */
  truncated: boolean;
  reading: boolean;
  error: string | null;
  onMore: () => void;
}

/** The turn history, newest first. */
export function TurnHistoryCard({ records, more, truncated, reading, error, onMore, nameOf }: HistoryProps) {
  return (
    <Card id="rotation-history-title" title="Turn history">
      {records.length === 0 ? (
        <p className={NOTE}>No turn has been assigned yet.</p>
      ) : (
        <Records records={records} caption="Every turn assigned, newest first: its member, why it was named, when its key signs from and whether its member took it." nameOf={nameOf} />
      )}
      {more && (
        <button type="button" aria-disabled={reading} onClick={() => { if (!reading) onMore(); }} className={TOGGLE}>
          {reading ? "Loading" : "Load older"}<span className="sr-only"> turns</span>
        </button>
      )}
      {error !== null && <p role="status" className="text-caption leading-relaxed text-amber">Could not read older turns: {error.replace(/\.+$/, "")}.</p>}
      {!more && truncated && records.length > 0 && <p className={NOTE}>The node keeps only its newest turns; older ones are not held.</p>}
    </Card>
  );
}
