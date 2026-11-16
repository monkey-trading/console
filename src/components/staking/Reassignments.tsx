"use client";

/** The Rotation tab's card of the skips, promotions and refused assignments among the turns read (monkey-trading/console#280). */

import { isReassignment, type TurnRecord } from "@/lib/staking/rotation";

import { Card } from "../monkey/Card";
import { NOTE } from "../monkey/styles";
import { TurnRecords, type Names } from "./TurnRecords";

/** The skips, promotions and refused assignments among the records read. */
export function Reassignments({ records, empty, nameOf }: { records: readonly TurnRecord[]; empty: string } & Names) {
  const moved = records.filter(isReassignment);
  return (
    <Card id="rotation-moves-title" title="Skips and promotions">
      <TurnRecords records={moved} caption="Turns that were reassigned by a skip or a promotion, or refused, newest first." empty={empty} nameOf={nameOf} />
      <p className={NOTE}>A skip passes a turn to the next operator in line when the assigned operator did not start its turn in time. A promotion hands the turn to the standby when the current operator stops responding. A refused turn changes nothing, and the current operator continues.</p>
    </Card>
  );
}
