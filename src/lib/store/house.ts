/** The House page's reads: the log's latest `set_params` and checkpoint, and the public withdrawal queue's size. */

import type { ConsoleStore } from "./store";

/**
 * Reads the house panel's state into the store: the latest applied `set_params` and checkpoint the
 * log records, which no REST route serves, and the public withdrawal queue's size. Called on every
 * refresh, like the markets and house reads; failures are reported once at the panel's own
 * granularity and the next refresh asks again.
 */
export async function readHousePanel(store: ConsoleStore): Promise<void> {
  const { client } = store.deps;
  const [params, checkpoint, totals] = await Promise.all([client.houseParams(), client.latestCheckpoint(), client.withdrawalTotals()]);
  store.patch({ houseParams: params, checkpoint, withdrawalTotals: totals });
}

/**
 * Starts a house panel read without awaiting it, so a slow walk of the withdrawal queue never
 * holds up the next market or account read; at most one runs at a time, and a failure is reported
 * once, deduplicated like the main read's.
 */
export function readHousePanelSoon(store: ConsoleStore): void {
  if (store.houseRead !== null) return;
  store.houseRead = readHousePanel(store).then(
    () => {
      store.lastHouseReadError = null;
      store.houseRead = null;
    },
    (error: unknown) => {
      store.houseRead = null;
      const message = error instanceof Error ? error.message : "The node did not answer the house panel's reads.";
      if (!store.noteAccess(error) && message !== store.lastHouseReadError) store.toast("error", message);
      store.lastHouseReadError = message;
    },
  );
}
