/**
 * Where the served history of the connected account begins (monkey-trading/console#526). Every read of
 * its history goes through `readHistory`, which keeps the start the server stated with the page, so a
 * view that lists history says from when it does, and never a fixed period.
 */

import type { HistoryPage } from "../engine/types";
import { formatStampWithYear } from "../time";
import type { ConsoleState } from "./state";
import type { ConsoleStore } from "./store";

type Params = { limit?: number; before?: string; kind?: string };

/** Reads one page of `account`'s history and keeps the start it states, the latest one, for that account. */
export async function readHistory(store: ConsoleStore, account: string, params: Params): Promise<HistoryPage> {
  const page = await store.deps.client.history(account, params);
  const ms = page.retained_from_ms;
  const held = store.getSnapshot().historyBegins;
  if (typeof ms === "number" && (held === null || held.account !== account || ms > held.ms)) store.patch({ historyBegins: { account, ms } });
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
export const LISTS = {
  history: { shown: "Your account history is shown", older: "history", none: "You have no account history" },
  results: { shown: "Your realised results are shown", older: "results", none: "You have no realised profit or loss" },
  withdrawals: { shown: "Your approved withdrawals are shown", older: "withdrawals", none: "You have no approved withdrawals" },
  distributions: { shown: "Your distributions are shown", older: "distributions", none: "No USDC has been distributed to you" },
} as const;

const verb = (list: keyof typeof LISTS) => (list === "history" ? "is" : "are");

/** The line each list shows with its rows: where it begins, and that older entries are not shown. */
export function historyBeginsNote(list: keyof typeof LISTS, ms: number): string {
  return `${LISTS[list].shown} from ${historyStart(ms)}. Older ${LISTS[list].older} ${verb(list)} not shown here.`;
}

/** The empty state of a list that states where it begins: nothing since then, and older entries are not shown. */
export function emptySince(list: keyof typeof LISTS, ms: number): string {
  return `${LISTS[list].none} since ${historyStart(ms)}, and older ${LISTS[list].older} ${verb(list)} not shown.`;
}
