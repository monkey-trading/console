/** The words of the P&L tab's MONKEY column and the notes under its header. */

import { formatFixedPlaces, formatUsd } from "./fixed";
import { formatMonkeyFigure, groupThousands } from "./format";
import { formatMark } from "./price-format";
import { formatStamp } from "./time";
import type { LedgerItem, LedgerTotals, Share } from "./ledger-share";
import type { LedgerState } from "./store/ledger";

/** Why a closed period can allocate an account nothing, for the "0" a losing row then shows. */
export const NO_ALLOCATION = "You earned no MONKEY in this reward period. This happens when a loss was written off, when an earlier write-off is still being repaid, or when your balance was negative at the end of the period.";
export const ACCRUES = "This is the MONKEY this loss earned. Each 10-minute reward period's MONKEY is shared in proportion to the losses in it. It builds up until you claim it.";
/** What the column's other words mean, shown under the ledger. */
export const COLUMN_NOTE = "Each loss earns a share of its 10-minute reward period's MONKEY, and what you earn builds up until you claim it. Pending means the period hasn't ended yet, and Loading means its figures are still loading. 0 means you earned nothing that period, for example because a loss was written off or your balance was negative when it ended.";

export interface MonkeyCell {
  text: string;
  title: string;
}

/** The MONKEY cell for a share; null for a win, which shows none. */
export function monkeyCell(share: Share, scheduleStatus: LedgerState["scheduleStatus"]): MonkeyCell | null {
  switch (share.kind) {
    case "none": return null;
    case "share": return { text: formatMonkeyFigure(share.units), title: ACCRUES };
    case "pending": return { text: "Pending", title: "This reward period hasn't ended yet. Your MONKEY for it is set when it does." };
    case "loading": return { text: "Loading", title: "This reward period's figures are still loading." };
    case "zero": return { text: "0", title: NO_ALLOCATION };
    case "unknown": return { text: "—", title: scheduleNotice(scheduleStatus) ?? "The reward period for this loss isn't known." };
    default: return never(share);
  }
}

function never(value: never): never {
  throw new Error(`Unhandled MONKEY share: ${JSON.stringify(value)}`);
}

/** The visible line for a schedule that could not be had, or null when it was. */
export function scheduleNotice(status: LedgerState["scheduleStatus"]): string | null {
  if (status === "unavailable") return "This server doesn't publish its MONKEY reward schedule, so MONKEY shows — for each loss.";
  if (status === "failed") return "The MONKEY reward schedule couldn't be loaded, so MONKEY shows — for each loss. Reopen this tab to try again.";
  return null;
}

/** What the header's totals cover, so a total over a part of the history says so. */
export function coverageNote(held: number, totals: LedgerTotals, more: boolean, full: boolean): string {
  const results = `${groupThousands(held)} result${held === 1 ? "" : "s"}`;
  const covers = full
    ? `Totals cover the ${results} loaded, the most this list holds. Older results aren't included.`
    : more ? `Totals cover the ${results} loaded so far. Load more to include older ones.` : "Totals cover all your realised results.";
  return totals.monkeyShort ? `${covers} The MONKEY total leaves out losses shown as Pending, Loading or —.` : covers;
}

/**
 * What the header says: the totals are blank until a read has landed (a stream row alone would make them
 * that one row), and the status line gives a read's error together with the coverage note, so a failed
 * "Load more" leaves the totals qualified.
 */
export function ledgerHeader(state: Pick<LedgerState, "status" | "error" | "scheduleStatus">, held: number, totals: LedgerTotals, more: boolean, full: boolean): { blank: boolean; status: string } {
  const ready = state.status === "ready";
  const parts = [state.error ?? "", ready ? coverageNote(held, totals, more, full) : "", scheduleNotice(state.scheduleStatus) ?? ""];
  return { blank: !ready, status: parts.filter(Boolean).join(" ") };
}

/** The texts of one ledger row, the same for its card and its table row. */
export function rowTexts({ row, share }: LedgerItem, places: number, scheduleStatus: LedgerState["scheduleStatus"]) {
  return {
    time: formatStamp(row.ts),
    closed: row.closed === null ? "Cash in lieu" : row.closed === "long" ? "Long" : "Short",
    qty: row.qty === null ? "—" : formatFixedPlaces(row.qty, 6),
    price: row.price === null ? "—" : formatMark(row.price, places),
    pnl: formatUsd(row.realised),
    loss: row.realised < 0n,
    fee: row.fee === 0n ? "—" : formatUsd(row.fee),
    monkey: monkeyCell(share, scheduleStatus),
    liquidation: row.liquidation,
  };
}
