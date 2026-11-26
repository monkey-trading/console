/**
 * Where the served history of the connected account begins (monkey-trading/console#526). The reads that
 * feed a list of history keep the start the server stated with the page, with the rows it produced, so a view that
 * lists history says from when it does, and never a fixed period.
 */

import type { HistoryPage } from "../engine/types";
import { formatStampWithYear } from "../time";
import type { ConsoleState } from "./state";

/** The earliest start `current` and the pages state: what a list that keeps its rows across reads says, since rows read at an earlier start may stay. */
export function earliestStart(current: number | null, pages: readonly HistoryPage[]): number | null {
  const stated = pages.flatMap((page) => (page.retained_from_ms === null ? [] : [page.retained_from_ms]));
  return stated.length === 0 ? current : Math.min(current ?? Infinity, ...stated);
}

/** Where the withdrawals list begins: the earliest start of the reads its rows came from, the recent history and the approvals. */
export function withdrawalsBegin(state: Pick<ConsoleState, "historyBegins" | "approvalsBegins">): number | null {
  const stated = [state.historyBegins, state.approvalsBegins].flatMap((ms) => (ms === null ? [] : [ms]));
  return stated.length === 0 ? null : Math.min(...stated);
}

/** The start as a trader reads it: UTC, with the year. */
export function historyStart(ms: number): string {
  return `${formatStampWithYear(ms)} UTC`;
}

/** What each list of history calls its entries: the subject of the sentence with its verb, and the older entries it leaves out. */
type Empties = "history" | "results" | "withdrawals";
const LISTS = {
  history: { shown: "Account history", older: "history" },
  results: { shown: "Realised results", older: "results" },
  withdrawals: { shown: "Approved withdrawals", older: "withdrawals" },
  distributions: { shown: "Distributions", older: "distributions" },
} as const;

const NONE: Record<Empties, string> = { history: "You have no account history", results: "You have no realised profit or loss", withdrawals: "You have no approved withdrawals" };
const verb = (list: keyof typeof LISTS) => (list === "history" ? "is" : "are");

/** The line each list shows with its rows: that entries before the start are not available, which claims nothing of what the list holds. */
export function historyBeginsNote(list: keyof typeof LISTS, ms: number): string {
  return `${LISTS[list].shown} before ${historyStart(ms)} ${verb(list)} not available here.`;
}

/** The empty state of a list that states where it begins: nothing since then, and older entries are not shown. */
export function emptySince(list: Empties, ms: number): string {
  return `${NONE[list]} since ${historyStart(ms)}, and older ${LISTS[list].older} ${verb(list)} not shown.`;
}
