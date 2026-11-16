/**
 * The Rotation tab's turn history as who ran the trading server and when (monkey-trading/console#435):
 * each takeover a turn record carries (`taken_ms`, when its operator's enclave logged `TurnTaken`) opens a
 * period that runs until the next takeover; a turn no one took over, refused or not taken up, sits in the
 * period of the operator that kept running the server; and the turns drawn but not yet taken over stand apart.
 */

import type { TurnReason } from "../engine/stats-types";
import { formatStamp } from "../time";
import { turnStartMs, type TurnRecord } from "./rotation";

/** A turn due while another operator ran the trading server, which no one took over. */
export interface KeptTurn {
  /** When the turn was due to begin. */
  atMs: number;
  refused: boolean;
}

/** One operator's time running the trading server. */
export interface TurnPeriod {
  /** The record of the turn its operator took over. */
  record: TurnRecord;
  fromMs: number;
  /** When the next operator took over; null while this one runs the server. */
  toMs: number | null;
  /** The turns due in it that no one took over, earliest first. */
  kept: readonly KeptTurn[];
}

export interface OperatingHistory {
  /** Newest first. */
  periods: readonly TurnPeriod[];
  /** The turns drawn and not yet taken over, soonest first. */
  upcoming: readonly TurnRecord[];
}

/**
 * Who ran the trading server across `records`, and the turns still to come. A turn some record of which was
 * taken was run; one with none taken is upcoming when its latest assignment is due after the latest takeover
 * and was not refused, and otherwise was kept by the operator running the server when it was due.
 */
export function operatingHistory(records: readonly TurnRecord[]): OperatingHistory {
  const taken = records.flatMap((record) => (record.takenMs === null ? [] : [{ record, fromMs: record.takenMs }])).sort((a, b) => a.fromMs - b.fromMs || a.record.assignedSeq - b.record.assignedSeq);
  const latestTakeover = taken.at(-1)?.fromMs ?? Number.NEGATIVE_INFINITY;
  const run = new Set(taken.map(({ record }) => record.turn));
  // A turn's latest assignment says how it stands: an earlier one was replaced by a skip or a promotion.
  const latest = new Map<number, TurnRecord>();
  for (const record of records) {
    const held = latest.get(record.turn);
    if (!run.has(record.turn) && (held === undefined || record.assignedSeq > held.assignedSeq)) latest.set(record.turn, record);
  }
  const upcoming: TurnRecord[] = [];
  const kept: KeptTurn[] = [];
  for (const record of latest.values()) {
    const atMs = turnStartMs(record);
    if (record.refused === null && atMs > latestTakeover) upcoming.push(record);
    else kept.push({ atMs, refused: record.refused !== null });
  }
  const periods = taken.map(({ record, fromMs }, index): TurnPeriod => {
    const toMs = taken[index + 1]?.fromMs ?? null;
    const within = kept.filter((turn) => turn.atMs >= fromMs && (toMs === null || turn.atMs < toMs)).sort((a, b) => a.atMs - b.atMs);
    return { record, fromMs, toMs, kept: within };
  });
  return { periods: periods.reverse(), upcoming: upcoming.sort((a, b) => turnStartMs(a) - turnStartMs(b)) };
}

/** How an operator took over the trading server, for a table's cell. */
export const TAKEOVER_CELL: Record<TurnReason, string> = { draw: "Scheduled hand-over", skip: "Skip", promotion: "Promotion of a standby" };

/** When a period ends: the next takeover, or now. */
export function periodEnd(period: TurnPeriod): string {
  return period.toMs === null ? "Now" : formatStamp(period.toMs);
}

/** What a period says of a turn its operator kept running through. */
export function keptLine(turn: KeptTurn): string {
  const why = turn.refused ? "which was refused" : "as the operator assigned to it did not take over";
  return `The operator continued to run the trading server through the turn due at ${formatStamp(turn.atMs)} UTC, ${why}.`;
}

/** Where an upcoming turn stands: scheduled, or due and waiting for its operator to take over. */
export function upcomingStatus(record: TurnRecord, nowMs: number): string {
  return nowMs > 0 && turnStartMs(record) <= nowMs ? "Due, not yet taken over" : "Scheduled";
}
