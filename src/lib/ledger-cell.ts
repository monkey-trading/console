/** The words of the P&L tab's MONKEY column and the notes under its header. */

import { formatFixedPlaces, formatUsd } from "./fixed";
import { formatMonkeyFigure, groupThousands } from "./format";
import { formatMark } from "./price-format";
import { formatStamp } from "./time";
import type { LedgerItem, LedgerTotals, Share } from "./ledger-share";
import type { LedgerState } from "./store/ledger";

/** Why a closed period can allocate an account nothing, for the "0" a losing row then shows. */
export const NO_ALLOCATION = "This period allocated nothing to the account. A period allocates nothing when the loss was written off, when debt from an earlier write-off is being paid down first, or when the account's cash was negative at the period's close.";
export const ACCRUES = "A share of the MONKEY the loss's ten-minute period allocated, in proportion to the period's losses. It accrues until claimed; the token mints on claim.";
/** What the column's other words mean, shown under the ledger. */
export const COLUMN_NOTE = "MONKEY is a share of the allocation of the ten-minute period a loss fell in, and accrues until claimed. Pending: the period is still open. Loading: more of its rows or its allocation are still to be read. 0: the period allocated nothing, as when a loss was written off, earlier write-off debt is paid down first, or cash was negative at its close.";

export interface MonkeyCell {
  text: string;
  title: string;
}

/** The MONKEY cell for a share; null for a win, which shows none. */
export function monkeyCell(share: Share, scheduleStatus: LedgerState["scheduleStatus"]): MonkeyCell | null {
  switch (share.kind) {
    case "none": return null;
    case "share": return { text: formatMonkeyFigure(share.units), title: ACCRUES };
    case "pending": return { text: "Pending", title: "The loss's period is still open. Its allocation is set when it closes." };
    case "loading": return { text: "Loading", title: "Not all of this period's rows or its allocation are read yet." };
    case "zero": return { text: "0", title: NO_ALLOCATION };
    case "unknown": return { text: "—", title: scheduleNotice(scheduleStatus) ?? "The loss's period cannot be told." };
    default: return never(share);
  }
}

function never(value: never): never {
  throw new Error(`Unhandled MONKEY share: ${JSON.stringify(value)}`);
}

/** The visible line for a schedule that could not be had, or null when it was. */
export function scheduleNotice(status: LedgerState["scheduleStatus"]): string | null {
  if (status === "unavailable") return "This node does not report its emission schedule, so MONKEY shows — for each loss.";
  if (status === "failed") return "The node did not answer the emission schedule read, so MONKEY shows — for each loss. Reopen this tab to ask again.";
  return null;
}

/** What the header's totals cover, so a total over a part of the history says so. */
export function coverageNote(held: number, totals: LedgerTotals, more: boolean, full: boolean): string {
  const results = `${groupThousands(held)} result${held === 1 ? "" : "s"}`;
  const covers = full
    ? `Totals cover the ${results} loaded, the most the ledger holds; results not loaded are left out.`
    : more ? `Totals cover the ${results} loaded so far, not the whole history. Load more for older ones.` : "Totals cover every realised result of this account.";
  return totals.monkeyShort ? `${covers} The MONKEY total leaves out losses shown as Pending, Loading or —.` : covers;
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
