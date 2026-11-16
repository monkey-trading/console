"use client";

/**
 * The Rotation tab's turn history card (monkey-trading/console#280, #435): who ran the trading server and
 * when, newest first, with older turns on "Load older", then the turns drawn but not yet taken over.
 */

import { failureText } from "@/lib/format";
import type { TurnRecord } from "@/lib/staking/rotation";
import { operatingHistory } from "@/lib/staking/turn-periods";

import { Card } from "../monkey/Card";
import { NOTE, TOGGLE } from "../monkey/styles";
import { TurnPeriods } from "./TurnPeriods";
import { UpcomingTurns } from "./UpcomingTurns";

const SUBHEAD = "text-label tracking-caps text-fg-3 uppercase";

interface HistoryProps {
  records: readonly TurnRecord[];
  /** What both lists say before the rotation is read, or why it could not be; null once it is. */
  unread: string | null;
  nowMs: number;
  /** Whether older turns can be read; null before the first read. The button's place is held either way, so no answer moves the card. */
  more: boolean | null;
  /** Whether the node dropped older turns for room. */
  truncated: boolean;
  reading: boolean;
  error: string | null;
  onMore: () => void;
  nameOf: (address: string) => string;
}

/** The periods, newest first, then the upcoming turns. */
export function TurnHistoryCard({ records, unread, nowMs, more, truncated, reading, error, onMore, nameOf }: HistoryProps) {
  const { periods, upcoming } = operatingHistory(records);
  const dropped = more === false && truncated && periods.length > 0;
  return (
    <Card id="rotation-history-title" title="Turn history">
      <TurnPeriods periods={periods} empty={unread ?? "No operator has taken over a turn yet."} nameOf={nameOf} />
      {more === true ? (
        <button type="button" aria-disabled={reading} onClick={() => { if (!reading) onMore(); }} className={TOGGLE}>
          {reading ? "Loading" : "Load older"}<span className="sr-only"> turns</span>
        </button>
      ) : <span aria-hidden="true" className={`${TOGGLE} inline-block invisible`}>Load older</span>}
      {/* Both lines stay mounted, so a change of their text is announced: the failure of an older read, and how many periods are shown once one lands. */}
      <p role="status" className="text-caption leading-relaxed text-amber empty:hidden">{error === null ? null : failureText("Older turns could not be loaded.", error)}</p>
      <p role="status" className="sr-only">{periods.length > 0 ? `${periods.length} ${periods.length === 1 ? "period" : "periods"} shown.` : ""}</p>
      {/* The note's line is held whether or not it shows, as the button's is. */}
      <p aria-hidden={dropped ? undefined : true} className={dropped ? NOTE : `${NOTE} invisible`}>Only the most recent turns are retained.</p>
      <h4 className={SUBHEAD}>Upcoming</h4>
      <UpcomingTurns upcoming={upcoming} empty={unread ?? "No upcoming turn has been drawn yet."} nowMs={nowMs} nameOf={nameOf} />
    </Card>
  );
}
