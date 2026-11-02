/** The House page's reads: the node's house state (the latest `set_params` and checkpoint) and the public withdrawal queue's size. */

import { QueueTotalsRetrying } from "../engine/live-queue";
import type { ConsoleStore } from "./store";

/**
 * Reads the house's parameters and checkpoint from the node into the store. Called on every
 * refresh, like the markets and house reads; a failure is reported once, deduplicated like the
 * queue's. A node that predates the route answers null: the panels say so, and nothing is reported.
 * Resolves true when the read succeeded.
 */
export function readHouseState(store: ConsoleStore): Promise<boolean> {
  return store.deps.client.houseState().then(
    (read) => {
      store.patch(
        read === null
          ? { houseParams: null, checkpoint: null, houseStateStatus: "unavailable" }
          : { houseParams: read.params, checkpoint: read.checkpoint, houseStateStatus: "read" },
      );
      return true;
    },
    (error: unknown) => {
      report(store, error, "state");
      return false;
    },
  );
}

/** Reads the public withdrawal queue's size into the store; resolves true when the walk succeeded. */
export function readHouseQueue(store: ConsoleStore): Promise<boolean> {
  return store.deps.client.withdrawalTotals().then(
    (totals) => {
      store.patch({ withdrawalTotals: totals, queueFailed: false });
      return true;
    },
    (error: unknown) => {
      report(store, error, "queue");
      store.patch({ queueFailed: true });
      return false;
    },
  );
}

/** Marks the House page open, so refreshes run its reads, and returns what closes it. The reads are for that page alone. */
export function openHousePanel(store: ConsoleStore): () => void {
  store.housePanelOpen = true;
  // Before the first refresh the node is not trusted yet; that refresh runs them.
  if (store.getSnapshot().houseReady) readHousePanelSoon(store);
  return () => {
    store.housePanelOpen = false;
  };
}

/**
 * Starts the house panel's reads without awaiting them, so a slow queue walk never holds up the
 * next market or account read. The house state read and the queue walk guard themselves separately, so a
 * slow walk cannot delay newer parameters or checkpoints; at most one of each runs at a time. The
 * failure latch clears only when a round of reads recovers, so a failure that repeats on every
 * refresh is shown once.
 */
export function readHousePanelSoon(store: ConsoleStore): void {
  if (store.stopped || !store.housePanelOpen) return;
  if (store.houseRead === null) {
    store.houseRead = readHouseState(store).then((ok) => {
      if (ok) store.lastHouseReadError = null;
      store.houseRead = null;
    });
  }
  if (store.queueRead === null) {
    store.queueRead = readHouseQueue(store).then((ok) => {
      if (ok) store.lastQueueReadError = null;
      store.queueRead = null;
    });
  }
}

/**
 * Reports one house panel read failure, deduplicated so a failure that repeats on every refresh is
 * shown once. The state read and the queue walk keep their own latches, cleared only when that read
 * recovers. A backoff wait is not a new failure: the walk's original rejection stays latched, so a
 * persistent outage toasts once and the wait's own message never alternates with it.
 */
function report(store: ConsoleStore, error: unknown, which: "state" | "queue"): void {
  if (error instanceof QueueTotalsRetrying) return;
  const message = error instanceof Error ? error.message : "The node did not answer the house panel's reads.";
  const latch = which === "state" ? "lastHouseReadError" : "lastQueueReadError";
  if (!store.noteAccess(error) && message !== store[latch]) store.toast("error", message);
  store[latch] = message;
}
