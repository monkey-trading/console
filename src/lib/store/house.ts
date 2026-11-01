/** The House page's reads: the log's latest `set_params`, checkpoint, and read status, and the public withdrawal queue's size. */

import type { ConsoleState } from "./state";
import type { ConsoleStore } from "./store";

/**
 * Reads the log-fed house state into the store: the latest applied `set_params`, the latest
 * checkpoint, and the log read's status, each published as its read lands. Called on every
 * refresh, like the markets and house reads; a failure is reported once, deduplicated like the
 * main read's. Resolves true when every read succeeded.
 */
export function readHouseLog(store: ConsoleStore): Promise<boolean> {
  const { client } = store.deps;
  const publish = <K extends "houseParams" | "checkpoint" | "houseStatus">(
    key: K,
    read: Promise<ConsoleState[K]>,
  ): Promise<boolean> =>
    read.then(
      (value) => {
        store.patch({ [key]: value });
        return true;
      },
      (error: unknown) => {
        report(store, error, "log");
        return false;
      },
    );
  // The shipped clients resolve these reads from folds that never reject; the handlers guard
  // implementations that do, so the page's panels degrade the way the queue walk's can.
  return Promise.all([
    publish("houseParams", client.houseParams()),
    publish("checkpoint", client.latestCheckpoint()),
    publish("houseStatus", client.houseLogStatus()),
  ]).then((ok) => ok.every(Boolean));
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

/**
 * Starts the house panel's reads without awaiting them, so a slow queue walk never holds up the
 * next market or account read. The log reads and the queue walk guard themselves separately, so a
 * slow walk cannot delay newer parameters or checkpoints; at most one of each runs at a time. The
 * failure latch clears only when a round of reads recovers, so a failure that repeats on every
 * refresh is shown once.
 */
export function readHousePanelSoon(store: ConsoleStore): void {
  if (store.stopped) return;
  if (store.houseRead === null) {
    store.houseRead = readHouseLog(store).then((ok) => {
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
 * shown once. The log reads and the queue walk keep their own latches, cleared only when that read
 * recovers.
 */
function report(store: ConsoleStore, error: unknown, which: "log" | "queue"): void {
  const message = error instanceof Error ? error.message : "The node did not answer the house panel's reads.";
  const latch = which === "log" ? "lastHouseReadError" : "lastQueueReadError";
  if (!store.noteAccess(error) && message !== store[latch]) store.toast("error", message);
  store[latch] = message;
}
