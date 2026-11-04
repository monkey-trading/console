/**
 * The connected account's USDC distributions by epoch (monkey-trading/console#271): its share of each
 * closed epoch (`distribution_allocated`) and, for an operator from the engine's V47, the operator's
 * share (`operator_share_allocated`), as the account's history route serves them newest first by
 * kind, with the stream's adding new ones. The two kinds are read as separate streams, so an epoch
 * shows only where both streams reach it, as the P&L ledger's cover does. Pure data: the reads fold.
 */

import type { HistoryEvent, HistoryPage, StreamMessage } from "../engine/types";

export type HistoryKind = "distribution_allocated" | "operator_share_allocated";
export const HISTORY_KINDS: readonly HistoryKind[] = ["distribution_allocated", "operator_share_allocated"];
/** Most epochs shown: reading stops there, and arrivals push the oldest out. Older epochs one stream has read and the other not yet are held beside them, at most a page of them. */
export const MAX_EPOCHS = 2_000;

/** What one closed epoch added to the account's cumulative distribution, in USDC base units. */
export interface EpochRow {
  epoch: number;
  /** The seq and stamp of the command that closed it. */
  seq: number;
  ts: number;
  /** Its share as a staker, and as the operator; null where the account had none of that kind. */
  staker: bigint | null;
  operator: bigint | null;
}

/** How far down one kind's stream is read: the seq of its oldest event read, and the cursor to read on from. */
export interface Cover {
  oldestSeq: number | null;
  next: string | null;
  done: boolean;
}

export interface DistributionHistory {
  /** Newest epoch first. */
  rows: readonly EpochRow[];
  cover: Readonly<Record<HistoryKind, Cover>>;
  /** The seq above which rows were kept when the bound pushed older ones out; null while none were. */
  trimmedBelow: number | null;
}

const UNREAD: Cover = { oldestSeq: null, next: null, done: false };
const UNITS = /^\d+$/;

/** A history with nothing read. */
export function emptyHistory(): DistributionHistory {
  return { rows: [], cover: { distribution_allocated: UNREAD, operator_share_allocated: UNREAD }, trimmedBelow: null };
}

/** The seq a `<seq>:<index>` cursor names. */
function seqOf(cursor: string): number {
  return Number(cursor.split(":")[0]);
}

/** The kind and amount of an event the history holds, or null for any other event or an amount that is not whole base units. */
function allocationOf(event: HistoryEvent): { kind: HistoryKind; epoch: number; amount: bigint } | null {
  if (event.type !== "distribution_allocated" && event.type !== "operator_share_allocated") return null;
  return UNITS.test(event.amount) ? { kind: event.type, epoch: event.epoch, amount: BigInt(event.amount) } : null;
}

/**
 * Folds events in: each epoch holds at most one event of each kind, so an event read twice (a page
 * and the stream) replaces itself. Past the bound the newest shown epochs are kept and every older
 * one dropped, and nothing below them shows again.
 */
function fold(data: DistributionHistory, events: readonly HistoryEvent[]): DistributionHistory {
  const byEpoch = new Map(data.rows.map((row) => [row.epoch, row]));
  for (const event of events) {
    const allocation = allocationOf(event);
    if (allocation === null) continue;
    const held = byEpoch.get(allocation.epoch) ?? { epoch: allocation.epoch, seq: seqOf(event.cursor), ts: event.ts, staker: null, operator: null };
    byEpoch.set(allocation.epoch, { ...held, [allocation.kind === "distribution_allocated" ? "staker" : "operator"]: allocation.amount });
  }
  const folded = { ...data, rows: [...byEpoch.values()].sort((a, b) => b.epoch - a.epoch) };
  const shown = shownRows(folded);
  if (shown.length <= MAX_EPOCHS) return folded;
  const kept = shown.slice(0, MAX_EPOCHS);
  const oldest = kept[kept.length - 1];
  return { ...folded, rows: kept, trimmedBelow: oldest === undefined ? data.trimmedBelow : oldest.seq };
}

/** Adds one page of `kind`, read from where its cover left off. */
export function addPage(data: DistributionHistory, kind: HistoryKind, page: HistoryPage): DistributionHistory {
  const last = page.events[page.events.length - 1];
  const was = data.cover[kind];
  const cover: Cover = { oldestSeq: last === undefined ? was.oldestSeq : seqOf(last.cursor), next: page.next, done: page.next === null };
  return fold({ ...data, cover: { ...data.cover, [kind]: cover } }, page.events);
}

/** Folds a stream message's allocations for `account` in; the same object when it carries none, so a price message changes nothing. */
export function addMessage(data: DistributionHistory, message: StreamMessage, account: string): DistributionHistory {
  const mine = account.toLowerCase();
  const events: HistoryEvent[] = [];
  message.events.forEach((event, index) => {
    if ((event.type === "distribution_allocated" || event.type === "operator_share_allocated") && event.account.toLowerCase() === mine) events.push({ ...event, cursor: `${message.seq}:${index}`, ts: message.ts });
  });
  return events.length === 0 ? data : fold(data, events);
}

/**
 * The lowest seq at which every epoch is held whole: a stream not read to its start has read every
 * event at or above its oldest, since an epoch's close carries at most one event of each kind for
 * the account. Infinity while a stream has not been read; -Infinity once both are read to their start.
 */
function heldFrom(data: DistributionHistory): number {
  const reach = HISTORY_KINDS.map((kind) => {
    const cover = data.cover[kind];
    return cover.done ? Number.NEGATIVE_INFINITY : (cover.oldestSeq ?? Number.POSITIVE_INFINITY);
  });
  return Math.max(...reach, data.trimmedBelow ?? Number.NEGATIVE_INFINITY);
}

/** The epochs the table may show: every one both streams have reached, newest first. */
export function shownRows(data: DistributionHistory): readonly EpochRow[] {
  const from = heldFrom(data);
  return data.rows.filter((row) => row.seq >= from);
}

/** Whether the shown epochs have reached the bound, or arrivals have pushed older ones out. */
export function atBound(data: DistributionHistory): boolean {
  return data.trimmedBelow !== null || shownRows(data).length >= MAX_EPOCHS;
}

/**
 * The streams whose next page can show more: those with more below them that stop no lower than
 * the other, since what shows starts where the higher of the two stops. Reading the lower one would
 * only hold more epochs that cannot show yet.
 */
export function limitingKinds(data: DistributionHistory): HistoryKind[] {
  const from = heldFrom(data);
  return HISTORY_KINDS.filter((kind) => !data.cover[kind].done && (data.cover[kind].oldestSeq ?? Number.POSITIVE_INFINITY) >= from);
}

/** Whether an older page can add epochs: a stream that limits what shows has more below it, and the bound has room. */
export function moreRemain(data: DistributionHistory): boolean {
  return !atBound(data) && limitingKinds(data).length > 0;
}

/** Whether any epoch shown paid the account an operator's share, so the table needs that column. */
export function hasOperatorShare(rows: readonly EpochRow[]): boolean {
  return rows.some((row) => row.operator !== null);
}
