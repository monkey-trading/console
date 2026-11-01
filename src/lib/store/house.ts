/** The House page's reads: the log's latest `set_params` and checkpoint, and the public withdrawal queue's size. */

import type { ConsoleState } from "./state";
import type { ConsoleStore } from "./store";

/**
 * Reads the house panel's state into the store: the latest applied `set_params` and checkpoint the
 * log records, which no REST route serves, and the public withdrawal queue's size. Called on every
 * refresh, like the markets and house reads. Each read publishes as it lands: a slow or failed
 * queue walk never withholds a fresh checkpoint or parameter, and a failure is reported once,
 * deduplicated like the main read's.
 */
export async function readHousePanel(store: ConsoleStore): Promise<void> {
  const { client } = store.deps;
  const [params, checkpoint, totals] = await Promise.allSettled([client.houseParams(), client.latestCheckpoint(), client.withdrawalTotals()]);
  const patch: Partial<Pick<ConsoleState, "houseParams" | "checkpoint" | "withdrawalTotals">> = {};
  if (params.status === "fulfilled") patch.houseParams = params.value;
  else report(store, params.reason);
  if (checkpoint.status === "fulfilled") patch.checkpoint = checkpoint.value;
  else report(store, checkpoint.reason);
  if (totals.status === "fulfilled") patch.withdrawalTotals = totals.value;
  else report(store, totals.reason);
  store.patch(patch);
}

/** Reports one house panel read failure, deduplicated so a failure that repeats on every refresh is shown once. */
function report(store: ConsoleStore, error: unknown): void {
  const message = error instanceof Error ? error.message : "The node did not answer the house panel's reads.";
  if (!store.noteAccess(error) && message !== store.lastHouseReadError) store.toast("error", message);
  store.lastHouseReadError = message;
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
