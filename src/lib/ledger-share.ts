/**
 * The MONKEY a losing row earned. The engine allocates per emission period, not per fill: the
 * account's `emission_allocated.amount` for a period is shared here over the period's losing rows
 * in proportion to their losses. Under the gross rule (engine#442) wins in the period do not
 * reduce a loss's weight, so a row's share needs only the losses. A share is told only where the
 * ledger holds the whole of what it depends on; otherwise the row says why not.
 */

import { periodOf, periodStart, type EmissionSchedule } from "./engine/emission-schedule";
import { allocationsHeldFrom, rowsHeldFrom, type LedgerData, type LedgerRow } from "./ledger";

/** What a row's MONKEY column shows. */
export type Share =
  /** A win: it earns nothing. */
  | { kind: "none" }
  /** The node reported no schedule, so the row's period is unknown. */
  | { kind: "unknown" }
  /** The row's period is still open. */
  | { kind: "pending" }
  /** The period closed, but the ledger does not yet hold all its losing rows or its allocation. */
  | { kind: "loading" }
  /** The period closed with no allocation to this account. */
  | { kind: "zero" }
  | { kind: "share"; units: bigint };

/**
 * `amount` split over `losses` in proportion, in whole units that sum to exactly `amount`: each
 * gets its floor, and the units left over go one each to the largest remainders, the oldest
 * (earliest in `losses`) first on a tie.
 */
export function splitExactly(amount: bigint, losses: readonly bigint[]): bigint[] {
  const total = losses.reduce((sum, loss) => sum + loss, 0n);
  if (total <= 0n) throw new Error("A period's losses to share an allocation over must be positive.");
  const shares = losses.map((loss) => (amount * loss) / total);
  const left = Number(amount - shares.reduce((sum, share) => sum + share, 0n));
  const byRemainder = losses.map((loss, index) => ({ index, remainder: (amount * loss) % total })).sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  // `left` is less than the number of losses, since each floor drops under one unit.
  for (const { index } of byRemainder.slice(0, left)) shares[index] = (shares[index] ?? 0n) + 1n;
  return shares;
}

/** Each losing row's share by cursor; wins are absent. */
export function sharesOf(data: LedgerData, schedule: EmissionSchedule | null): ReadonlyMap<string, Share> {
  const shares = new Map<string, Share>();
  const byPeriod = new Map<number, LedgerRow[]>();
  for (const row of data.rows) {
    if (row.realised >= 0n) continue;
    if (schedule === null) {
      shares.set(row.cursor, { kind: "unknown" });
      continue;
    }
    const period = periodOf(schedule, row.ts);
    const held = byPeriod.get(period);
    if (held) held.push(row);
    else byPeriod.set(period, [row]);
  }
  if (schedule === null) return shares;
  const rowsFrom = rowsHeldFrom(data);
  const allocationsFrom = allocationsHeldFrom(data);
  const allocated = new Map(data.allocations.map((a) => [a.period, a.amount]));
  for (const [period, rows] of byPeriod) {
    const settle = (share: Share) => rows.forEach((row) => shares.set(row.cursor, share));
    const amount = allocated.get(period);
    if (period > data.closedThrough) settle({ kind: "pending" });
    // A row stamped at the oldest stamp read may have siblings a page cut off; strictly newer is whole.
    // A held allocation is known whatever the cover; only its absence needs the stream to have reached back.
    else if (periodStart(schedule, period) <= rowsFrom || (amount === undefined && periodStart(schedule, period + 1) <= allocationsFrom)) settle({ kind: "loading" });
    else {
      if (amount === undefined) settle({ kind: "zero" });
      else {
        const oldestFirst = [...rows].reverse();
        const parts = splitExactly(amount, oldestFirst.map((row) => -row.realised));
        oldestFirst.forEach((row, i) => shares.set(row.cursor, { kind: "share", units: parts[i] ?? 0n }));
      }
    }
  }
  return shares;
}

export interface LedgerTotals {
  realised: bigint;
  fees: bigint;
  /** The MONKEY of the rows whose share is known. */
  monkey: bigint;
  /** Whether some losing row's share is not known yet, so `monkey` is short of its full total. */
  monkeyShort: boolean;
}

/** Sums over `rows`: realised results, fees, and the MONKEY of the rows whose share is known. */
export function totalsOf(rows: readonly LedgerRow[], shares: ReadonlyMap<string, Share>): LedgerTotals {
  const totals: LedgerTotals = { realised: 0n, fees: 0n, monkey: 0n, monkeyShort: false };
  for (const row of rows) {
    totals.realised += row.realised;
    totals.fees += row.fee;
    const share = shares.get(row.cursor);
    if (share?.kind === "share") totals.monkey += share.units;
    else if (share?.kind === "pending" || share?.kind === "loading" || share?.kind === "unknown") totals.monkeyShort = true;
  }
  return totals;
}

/** A row with what its MONKEY column shows. */
export interface LedgerItem {
  row: LedgerRow;
  share: Share;
}

export interface LedgerView {
  items: readonly LedgerItem[];
  totals: LedgerTotals;
}

/** Every held row with its share and the totals over them; computed when the held data or schedule changes, not per price patch. */
export function viewOf(data: LedgerData, schedule: EmissionSchedule | null): LedgerView {
  const shares = sharesOf(data, schedule);
  return { items: data.rows.map((row) => ({ row, share: shares.get(row.cursor) ?? { kind: "none" } })), totals: totalsOf(data.rows, shares) };
}
