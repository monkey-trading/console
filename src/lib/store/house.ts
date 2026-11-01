/** The House page's reads: the log's latest `set_params` and checkpoint, and the public withdrawal queue's size. */

import type { ConsoleStore } from "./store";

/**
 * Reads the house panel's state into the store: the latest `set_params` and checkpoint the log
 * records, which no REST route serves, and the public withdrawal queue's size. Called on every
 * refresh, like the markets and house reads; failures are reported by the caller's read, and the
 * next refresh asks again.
 */
export async function readHousePanel(store: ConsoleStore): Promise<void> {
  const { client } = store.deps;
  const [params, checkpoint, totals] = await Promise.all([client.houseParams(), client.latestCheckpoint(), client.withdrawalTotals()]);
  store.patch({ houseParams: params, checkpoint, withdrawalTotals: totals });
}
