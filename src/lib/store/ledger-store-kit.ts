/** Tests only: a store with a connected account whose history the test canned. */

import { settle } from "../engine/test-kit";
import type { HistoryPage } from "../engine/types";
import { page, SCHEDULE } from "../ledger-kit";
import { connectWallet } from "./actions";
import { setup } from "./live-fake";

/** A store with a connected account whose history, by kind, is `pages` (the page for `before`, or the first when it is absent). */
export async function opened(pages: Partial<Record<string, Record<string, HistoryPage>>> = {}) {
  const { client, store } = setup();
  client.historyAnswer = ({ kind, before }) => pages[kind ?? ""]?.[before ?? ""] ?? page([]);
  client.schedule = SCHEDULE;
  store.start(0);
  await settle();
  await connectWallet(store, "watch", true);
  await settle();
  client.historyReads.length = 0;
  client.scheduleReads = 0;
  return { client, store, ledger: () => store.getSnapshot().ledger, reads: () => client.historyReads.filter((r) => r.kind !== undefined) };
}

