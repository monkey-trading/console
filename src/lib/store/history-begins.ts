/**
 * Where the served history of the connected account begins (monkey-trading/console#526). The reads that
 * feed a list of history (`readHistory`) keep the start the server stated with the page, so a view that
 * lists history says from when it does, and never a fixed period.
 */

import type { HistoryPage } from "../engine/types";
import { formatStampWithYear } from "../time";
import type { ConsoleState } from "./state";
import type { ConsoleStore } from "./store";

type Params = { limit?: number; before?: string; kind?: string };

/** Reads one page of `account`'s history and keeps the start it states, the latest one, while `account` is the connected wallet's: a late answer for an account left behind changes nothing. */
export async function readHistory(store: ConsoleStore, account: string, params: Params): Promise<HistoryPage> {
  const page = await store.deps.client.history(account, params);
  const ms = page.retained_from_ms;
  const { historyBegins: held, wallet } = store.getSnapshot();
  if (typeof ms === "number" && wallet?.address.toLowerCase() === account.toLowerCase() && (held === null || held.account !== account || ms > held.ms)) store.patch({ historyBegins: { account, ms } });
  return page;
}

/** When the connected account's served history begins, or null before a read states it. */
export function historyBeginsOf(state: Pick<ConsoleState, "historyBegins" | "wallet">): number | null {
  const { historyBegins, wallet } = state;
  return historyBegins !== null && wallet !== null && historyBegins.account.toLowerCase() === wallet.address.toLowerCase() ? historyBegins.ms : null;
}

/** The start as a trader reads it: UTC, with the year. */
export function historyStart(ms: number): string {
  return `${formatStampWithYear(ms)} UTC`;
}

/** What each list of history calls its entries: the subject of the sentence with its verb, and the older entries it leaves out. */
type Empties = "history" | "results" | "withdrawals";
const LISTS = {
  history: { shown: "Your account history is available", older: "history" },
  results: { shown: "Your realised results are available", older: "results" },
  withdrawals: { shown: "Your approved withdrawals are available", older: "withdrawals" },
  distributions: { shown: "Your distributions are available", older: "distributions" },
} as const;

const NONE: Record<Empties, string> = { history: "You have no account history", results: "You have no realised profit or loss", withdrawals: "You have no approved withdrawals" };
const verb = (list: keyof typeof LISTS) => (list === "history" ? "is" : "are");

/** The line each list shows with its rows: where it begins, and that older entries are not shown. */
export function historyBeginsNote(list: keyof typeof LISTS, ms: number): string {
  return `${LISTS[list].shown} from ${historyStart(ms)}. Older ${LISTS[list].older} ${verb(list)} not shown here.`;
}

/** The empty state of a list that states where it begins: nothing since then, and older entries are not shown. */
export function emptySince(list: Empties, ms: number): string {
  return `${NONE[list]} since ${historyStart(ms)}, and older ${LISTS[list].older} ${verb(list)} not shown.`;
}
