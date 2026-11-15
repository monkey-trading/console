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
      <TurnRecords records={moved} caption="Turns reassigned by a skip or a promotion, or refused, newest first." empty={empty} nameOf={nameOf} />
      <p className={NOTE}>A skip names the next member in the turn&apos;s order when the one before it did not take the turn in time. A promotion moves the turn from a failed member by the liveness rule. A refused assignment changes nothing: the key in effect stays.</p>
    </Card>
  );
}
