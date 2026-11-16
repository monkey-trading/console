"use client";

/** The Rotation tab's card of the skips, promotions and refused assignments among the turns read (monkey-trading/console#280), by start time. */

import { isReassignment, type TurnRecord } from "@/lib/staking/rotation";

import { Card } from "../monkey/Card";
import { NOTE } from "../monkey/styles";
import { TurnRecords, type Names } from "./TurnRecords";

/** The skips, promotions and refused assignments among the records read. */
export function Reassignments({ records, empty, nameOf }: { records: readonly TurnRecord[]; empty: string } & Names) {
  const moved = records.filter(isReassignment);
  return (
    <Card id="rotation-moves-title" title="Reassigned and refused turns">
      <TurnRecords records={moved} caption="Turns passed to another operator by a skip or a promotion, and turns that were refused, by start time, newest first." empty={empty} nameOf={nameOf} />
      <p className={NOTE}>A turn is skipped to the next operator in line when the operator assigned to it does not start in time. A promotion passes the trading server to a standby operator when the operator running it stops responding. A turn is refused when the operator assigned to it cannot take over, for example because it was not announced far enough in advance, and the operator already running the trading server then stays in place.</p>
    </Card>
  );
}
