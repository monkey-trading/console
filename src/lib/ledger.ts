/**
 * The P&L ledger's rows and what is held of them. The ledger reads the account's history by event
 * kind, newest first, so it holds a newest-first prefix of each kind's stream: `LedgerCover` says
 * how far down each stream was read, and every claim about a period (its losses, its allocation)
 * is made only where the streams reach. Pure data: the store reads, this folds.
 */

import { periodOf, periodStart, type EmissionSchedule } from "./engine/emission-schedule";
import type { HistoryEvent, HistoryPage, MarketId, StreamMessage } from "./engine/types";
import { fixedFromWire, type Fixed } from "./fixed";

/** The event kinds the ledger reads: the two that make rows, and the allocations that price them. */
export type LedgerKind = "fill" | "corporate_cash_in_lieu" | "emission_allocated";
export const LEDGER_KINDS: readonly LedgerKind[] = ["fill", "corporate_cash_in_lieu", "emission_allocated"];
/** The kinds that make rows. */
export const ROW_KINDS = ["fill", "corporate_cash_in_lieu"] as const;
/**
 * Most rows held; reading stops there and live arrivals push the oldest out. An allocation
 * belongs to a period with a losing row, so allocations read to reach the rows stay under
 * `MAX_ALLOCATIONS`, which leaves room for one page read past them.
 */
export const MAX_ROWS = 2_000;
export const MAX_ALLOCATIONS = MAX_ROWS + 100;

/** One realised result: a fill that realised a profit or loss, or a split's cash in lieu. */
export interface LedgerRow {
  cursor: string;
  ts: number;
  kind: "fill" | "corporate_cash_in_lieu";
  market: MarketId;
  /** The position side the fill closed (a sell closes a long); null for cash in lieu, which names none. */
  closed: "long" | "short" | null;
  qty: Fixed | null;
  price: Fixed | null;
  /** Signed USD realised. */
  realised: Fixed;
  fee: Fixed;
  liquidation: boolean;
}

/** The account's MONKEY allocation for one emission period, in base units. */
export interface Allocation {
  cursor: string;
  ts: number;
  period: number;
  amount: bigint;
}

/** How far down one kind's stream was read: `oldest` is the stamp of the oldest event read, `next` the cursor to read on from. */
export interface LedgerCover {
  oldest: number | null;
  next: string | null;
  done: boolean;
}

export interface LedgerData {
  /** Newest first. */
  rows: readonly LedgerRow[];
  /** Newest first. */
  allocations: readonly Allocation[];
  cover: Readonly<Record<LedgerKind, LedgerCover>>;
  /** The highest emission period known to have closed; -1 when none is. */
  closedThrough: number;
}

const UNREAD: LedgerCover = { oldest: null, next: null, done: false };

/** A ledger with nothing read. */
export function emptyLedger(): LedgerData {
  return { rows: [], allocations: [], cover: { fill: UNREAD, corporate_cash_in_lieu: UNREAD, emission_allocated: UNREAD }, closedThrough: -1 };
}

/** Orders cursors `<seq>:<index>` newest first. */
function newerFirst(a: { cursor: string }, b: { cursor: string }): number {
  const [aSeq = 0, aIndex = 0] = a.cursor.split(":").map(Number);
  const [bSeq = 0, bIndex = 0] = b.cursor.split(":").map(Number);
  return bSeq - aSeq || bIndex - aIndex;
}

type Entry = HistoryEvent;

/** The row an event makes, or null for an event that is not a realised result (a fill that realised nothing included). */
export function rowOf(event: Entry): LedgerRow | null {
  if (event.type === "fill") {
    const realised = fixedFromWire(event.realised_pnl);
    if (realised === 0n) return null;
    // `position` is the signed size after the fill, so the size before it says which side the fill closed and how much of it
    // (a fill that reverses a position closes only what was held; the rest opened the other side).
    const qty = fixedFromWire(event.qty);
    const before = fixedFromWire(event.position) - (event.side === "buy" ? qty : -qty);
    const held = before < 0n ? -before : before;
    return { cursor: event.cursor, ts: event.ts, kind: "fill", market: event.market, closed: before > 0n ? "long" : "short", qty: held < qty ? held : qty, price: fixedFromWire(event.price), realised, fee: fixedFromWire(event.profit_fee), liquidation: event.liquidation };
  }
  if (event.type === "corporate_cash_in_lieu") {
    const realised = fixedFromWire(event.amount);
    if (realised === 0n) return null;
    return { cursor: event.cursor, ts: event.ts, kind: "corporate_cash_in_lieu", market: event.market, closed: null, qty: null, price: null, realised, fee: 0n, liquidation: false };
  }
  return null;
}

/** The allocation an event records, or null for any other event. */
function allocationOf(event: Entry): Allocation | null {
  return event.type === "emission_allocated" ? { cursor: event.cursor, ts: event.ts, period: event.period, amount: BigInt(event.amount) } : null;
}

/** Adds entries, dropping any already held by cursor, and keeps both lists newest first. */
function fold(data: LedgerData, entries: readonly Entry[]): LedgerData {
  if (entries.length === 0) return data;
  const held = new Set([...data.rows, ...data.allocations].map((item) => item.cursor));
  const fresh = entries.filter((entry) => !held.has(entry.cursor));
  const rows = fresh.flatMap((entry) => rowOf(entry) ?? []);
  const allocations = fresh.flatMap((entry) => allocationOf(entry) ?? []);
  if (rows.length === 0 && allocations.length === 0) return data;
  const newRows = rows.length === 0 ? data.rows : [...data.rows, ...rows].sort(newerFirst);
  const newAllocations = allocations.length === 0 ? data.allocations : [...data.allocations, ...allocations].sort(newerFirst);
  const closedThrough = allocations.reduce((high, a) => Math.max(high, a.period), data.closedThrough);
  return { ...data, rows: newRows, allocations: newAllocations, closedThrough };
}

/** The cover after the oldest items of a kind were dropped to stay in bounds: reading resumes below the oldest one kept (`kept`, newest first). */
function trimmedCover(kept: readonly { cursor: string; ts: number }[], was: LedgerCover): LedgerCover {
  const last = kept[kept.length - 1];
  return last === undefined ? was : { oldest: last.ts, next: last.cursor, done: false };
}

/** Drops the oldest rows and allocations past the bounds. */
function bound(data: LedgerData): LedgerData {
  if (data.rows.length <= MAX_ROWS && data.allocations.length <= MAX_ALLOCATIONS) return data;
  let { rows, allocations, cover } = data;
  if (rows.length > MAX_ROWS) {
    // Only a kind that lost a row resumes below its oldest kept one; the other is still read to where it was.
    const dropped = new Set(rows.slice(MAX_ROWS).map((r) => r.kind));
    rows = rows.slice(0, MAX_ROWS);
    for (const kind of dropped) cover = { ...cover, [kind]: trimmedCover(rows.filter((r) => r.kind === kind), cover[kind]) };
  }
  if (allocations.length > MAX_ALLOCATIONS) {
    allocations = allocations.slice(0, MAX_ALLOCATIONS);
    cover = { ...cover, emission_allocated: trimmedCover(allocations, cover.emission_allocated) };
  }
  return { ...data, rows, allocations, cover };
}

/** Folds one page of `kind`'s stream (newest first, read from `before`) into the ledger. */
export function addPage(data: LedgerData, kind: LedgerKind, page: HistoryPage): LedgerData {
  const last = page.events[page.events.length - 1];
  const was = data.cover[kind];
  const oldest = last === undefined ? was.oldest : Math.min(last.ts, was.oldest ?? last.ts);
  const cover: LedgerCover = { oldest, next: page.next, done: page.next === null };
  return bound(fold({ ...data, cover: { ...data.cover, [kind]: cover } }, page.events));
}

/**
 * Folds a stream message's events for `account` in as they arrive; returns the same object when
 * nothing in it concerns the ledger, so a price message changes nothing. A period close raises
 * `closedThrough`: the allocations of that period came with it.
 */
export function addMessage(data: LedgerData, message: StreamMessage, account: string): LedgerData {
  const mine = account.toLowerCase();
  const entries: Entry[] = [];
  let closed = data.closedThrough;
  message.events.forEach((event, index) => {
    if (event.type === "emission_period_closed") closed = Math.max(closed, event.period);
    else if ("account" in event && event.account.toLowerCase() === mine) entries.push({ ...event, cursor: `${message.seq}:${index}`, ts: message.ts });
  });
  const folded = fold(data, entries);
  return closed === folded.closedThrough ? bound(folded) : bound({ ...folded, closedThrough: closed });
}

/** Records that the periods before the schedule's open one have closed. */
export function closedBefore(data: LedgerData, schedule: EmissionSchedule): LedgerData {
  return schedule.period === null || schedule.period - 1 <= data.closedThrough ? data : { ...data, closedThrough: schedule.period - 1 };
}

/**
 * The stamp above which every row of both row kinds is held: events strictly newer than it are all
 * read, since a page may cut between events of one stamp. -Infinity once both streams are read to
 * their start, Infinity while one has not been read.
 */
export function rowsHeldFrom(data: LedgerData): number {
  return Math.max(...ROW_KINDS.map((kind) => coverFrom(data.cover[kind])));
}

/** The same for the allocations stream. */
export function allocationsHeldFrom(data: LedgerData): number {
  return coverFrom(data.cover.emission_allocated);
}

/** The stamp above which a stream's events are all read. */
function coverFrom(cover: LedgerCover): number {
  return cover.done ? Number.NEGATIVE_INFINITY : (cover.oldest ?? Number.POSITIVE_INFINITY);
}

/** Whether another read can add rows: a row stream has more below it. */
export function rowsRemain(data: LedgerData): boolean {
  return !data.cover.fill.done || !data.cover.corporate_cash_in_lieu.done;
}

/** The first instant of the period a stamp falls in. */
function periodStartOf(schedule: EmissionSchedule, ts: number): number {
  return periodStart(schedule, periodOf(schedule, ts));
}

/** Whether the allocations stream has not reached the oldest row's period, so a missing allocation there cannot be told from an unread one. */
export function allocationsShort(data: LedgerData, schedule: EmissionSchedule | null): boolean {
  if (schedule === null || data.cover.emission_allocated.done) return false;
  // The oldest row whose period the row streams hold whole: older rows wait on their own streams, not on allocations.
  const from = rowsHeldFrom(data);
  const oldest = data.rows.findLast((row) => periodStartOf(schedule, row.ts) > from);
  if (oldest === undefined) return false;
  const period = periodOf(schedule, oldest.ts);
  if (data.allocations.some((a) => a.period === period)) return false;
  return schedule.startMs + (period + 1) * schedule.periodMs <= allocationsHeldFrom(data);
}

/** Whether the ledger holds as many rows as it may, so reading on would only push held rows out. */
export function atBound(data: LedgerData): boolean {
  return data.rows.length >= MAX_ROWS;
}
