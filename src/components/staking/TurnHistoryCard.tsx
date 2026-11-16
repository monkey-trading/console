"use client";

/** The Rotation tab's turn history card (monkey-trading/console#280): every turn assigned, newest first, with older turns on "Load older". */

import { errorText } from "@/lib/format";
import type { TurnRecord } from "@/lib/staking/rotation";

import { Card } from "../monkey/Card";
import { NOTE, TOGGLE } from "../monkey/styles";
import { TurnRecords, type Names } from "./TurnRecords";

interface HistoryProps extends Names {
  records: readonly TurnRecord[];
  /** What the viewport says with no record. */
  empty: string;
  /** Whether older turns can be read; null before the first read. The button's place is held either way, so no answer moves the card. */
  more: boolean | null;
  /** Whether the node dropped older turns for room. */
  truncated: boolean;
  reading: boolean;
  error: string | null;
  onMore: () => void;
}

/** The turn history, newest first. */
export function TurnHistoryCard({ records, empty, more, truncated, reading, error, onMore, nameOf }: HistoryProps) {
  const dropped = more === false && truncated && records.length > 0;
  return (
    <Card id="rotation-history-title" title="Turn history">
      <TurnRecords records={records} caption="Every turn, newest first, showing the operator, how it was chosen, when its turn starts and whether it has started." empty={empty} nameOf={nameOf} />
      {more === true ? (
        <button type="button" aria-disabled={reading} onClick={() => { if (!reading) onMore(); }} className={TOGGLE}>
          {reading ? "Loading" : "Load older"}<span className="sr-only"> turns</span>
        </button>
      ) : <span aria-hidden="true" className={`${TOGGLE} inline-block invisible`}>Load older</span>}
      {/* Both lines stay mounted, so a change of their text is announced: the failure of an older read, and how many turns are shown once one lands. */}
      <p role="status" className="text-caption leading-relaxed text-amber empty:hidden">{error === null ? null : errorText("Older turns could not be loaded.", error)}</p>
      <p role="status" className="sr-only">{records.length > 0 ? `${records.length} ${records.length === 1 ? "turn" : "turns"} shown.` : ""}</p>
      {/* The note's line is held whether or not it shows, as the button's is. */}
      <p aria-hidden={dropped ? undefined : true} className={dropped ? NOTE : `${NOTE} invisible`}>Only the most recent turns are retained.</p>
    </Card>
  );
}
