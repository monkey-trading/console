/** The words of the P&L tab's MONKEY column and the notes under its header. */

import { formatFixedPlaces, formatUsd } from "./fixed";
import { formatMonkeyFigure, groupThousands } from "./format";
import { formatMark } from "./price-format";
import { formatStamp } from "./time";
import type { LedgerItem, LedgerTotals, Share } from "./ledger-share";
import type { LedgerState } from "./store/ledger";

/** Why a closed period can allocate an account nothing, for the "0" a losing row then shows. */
export const NO_ALLOCATION = "You earned no MONKEY in this reward period. This happens when a loss was written off, when an earlier write-off is still being repaid, or when your balance was negative at the end of the period.";
export const ACCRUES = "The MONKEY earned by this loss. In each ten-minute reward period, a fixed amount of MONKEY is distributed among the traders who realised a loss in that period, in proportion to the size of their losses. Your MONKEY accumulates until you claim it.";
/** What the column's other words mean, shown under the ledger. */
export const COLUMN_NOTE = "Each realised loss earns a share of the MONKEY distributed in its ten-minute reward period, and your MONKEY accumulates until you claim it. Pending means the reward period has not yet ended, and Loading means its figures are still loading. A value of 0 means you earned nothing in that period, for example because a loss was written off or your balance was negative when the period ended.";

export interface MonkeyCell {
  text: string;
  title: string;
}

/** The MONKEY cell for a share; null for a win, which shows none. */
export function monkeyCell(share: Share, scheduleStatus: LedgerState["scheduleStatus"]): MonkeyCell | null {
  switch (share.kind) {
    case "none": return null;
    case "share": return { text: formatMonkeyFigure(share.units), title: ACCRUES };
    case "pending": return { text: "Pending", title: "This reward period has not yet ended. Your MONKEY for the period will be determined when it ends." };
    case "loading": return { text: "Loading", title: "This reward period's figures are still loading." };
    case "zero": return { text: "0", title: NO_ALLOCATION };
    case "unknown": return { text: "—", title: scheduleNotice(scheduleStatus) ?? "The reward period for this loss is not known." };
    default: return never(share);
  }
}

function never(value: never): never {
  throw new Error(`Unhandled MONKEY share: ${JSON.stringify(value)}`);
}

/** The visible line for a schedule that could not be had, or null when it was. */
export function scheduleNotice(status: LedgerState["scheduleStatus"]): string | null {
  if (status === "unavailable") return "This server does not publish its MONKEY reward schedule, so the MONKEY column shows — for each loss.";
  if (status === "failed") return "The MONKEY reward schedule could not be loaded, so the MONKEY column shows — for each loss. Reopen this tab to try again.";
  return null;
}

/** What the header's totals cover, so a total over a part of the history says so. */
export function coverageNote(held: number, totals: LedgerTotals, more: boolean, full: boolean): string {
  const results = `${groupThousands(held)} result${held === 1 ? "" : "s"}`;
  const covers = full
    ? `The totals cover the ${results} loaded, which is the maximum this list can hold. Older results are not included.`
    : more ? `The totals cover the ${results} loaded so far. Select Load more to include older results.` : "The totals cover all of your realised results.";
  return totals.monkeyShort ? `${covers} The MONKEY total excludes losses shown as Pending, Loading or —.` : covers;
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
