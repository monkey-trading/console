/**
 * The node's house state (the latest `set_params`, the pending listing notices and the checkpoint),
 * which the House page and the trading surfaces' prices and fees read, and the House page's public
 * withdrawal queue size.
 */

import { QueueTotalsRetrying } from "../engine/live-queue";
import { HOUSE_STATE, ROUTE_ABSENT_MS } from "./quiet-reads";
import type { ConsoleStore } from "./store";
import { awaitsTrust } from "./signing";

/**
 * Reads the house's parameters and checkpoint from the node into the store. Called on every
 * refresh, like the markets and house reads; a failure says nothing here, the panels wait for the next
 * read. A node that predates the route answers null: the panels say so, and
 * the route is not asked again until the page reopens, the node restarts or `ROUTE_ABSENT_MS` passes.
 * Resolves true when the read succeeded.
 */
export function readHouseState(store: ConsoleStore): Promise<boolean> {
  if (store.quiet.resting(HOUSE_STATE)) return Promise.resolve(true);
  const mark = store.quiet.mark();
  // The changes asked for so far; a stream change while this read runs asks again.
  const asked = store.pricingAsked;
  return store.deps.client.houseState().then(
    (read) => {
      if (read === null) store.quiet.rest(HOUSE_STATE, ROUTE_ABSENT_MS, mark);
      store.pricingRead = Math.max(store.pricingRead, asked);
      const pricingCurrent = store.pricingRead >= store.pricingAsked;
      store.patch(
        read === null
          ? { houseParams: null, checkpoint: null, listingNotices: {}, houseStateStatus: "unavailable", pricingCurrent }
          : { houseParams: read.params, checkpoint: read.checkpoint, listingNotices: read.listingNotices, houseStateStatus: "read", pricingCurrent },
      );
      return true;
    },
    (error: unknown) => {
      store.noteAccess(error);
      // Until a read has landed the panels would wait for ever; they say it failed, and the next read tries again.
      // So does a read after a change the stream carried: the trading surfaces then say the terms they held are not current.
      if (!awaitsTrust(error) && (store.getSnapshot().houseStateStatus === "pending" || store.pricingAsked > store.pricingRead)) store.patch({ houseStateStatus: "failed" });
      return false;
    },
  );
}

/**
 * Marks the house state the store holds as behind the node's: the stream carried a change to the
 * parameters, a listing or a notice, or resumed after a gap that may have held one. The next refresh
 * reads it again; until a read after this lands, a position's fee is the account read's own.
 */
export function stalePricing(store: ConsoleStore): void {
  store.pricingAsked += 1;
  if (store.getSnapshot().pricingCurrent) store.patch({ pricingCurrent: false });
}

/** Reads the public withdrawal queue's size into the store; resolves true when the walk succeeded. */
export function readHouseQueue(store: ConsoleStore): Promise<boolean> {
  return store.deps.client.withdrawalTotals().then(
    (totals) => {
      store.patch({ withdrawalTotals: totals, queueFailed: false });
      return true;
    },
    (error: unknown) => {
      if (!(error instanceof QueueTotalsRetrying)) store.noteAccess(error);
      store.patch({ queueFailed: true });
      return false;
    },
  );
}

/** Marks the House page open, so refreshes run its reads, and returns what closes it. The reads are for that page alone. */
export function openHousePanel(store: ConsoleStore): () => void {
  store.housePanelOpen = true;
  store.quiet.reset(); // a page opened again asks a node that lacked the route afresh
  store.houseStats.setOpen(true);
  // Before the first refresh the node is not trusted yet; that refresh runs them.
  if (store.getSnapshot().houseReady) readHousePanelSoon(store);
  return () => {
    store.housePanelOpen = false;
    store.houseStats.setOpen(false);
  };
}

/**
 * Starts the house state read and the House page's queue walk without awaiting them, so a slow queue
 * walk never holds up the next market or account read. The house state is read while the House page
 * is open, and on any page while the stream has made the pricing it holds stale. The read and the walk
 * guard themselves separately, so a slow walk cannot delay newer parameters or checkpoints; at most one
 * of each runs at a time.
 */
export function readHousePanelSoon(store: ConsoleStore): void {
  if (store.stopped) return;
  if (store.houseRead === null && (store.housePanelOpen || store.pricingAsked > store.pricingRead)) {
    store.houseRead = readHouseState(store).then(() => {
      store.houseRead = null;
    });
  }
  if (store.housePanelOpen && store.queueRead === null) {
    store.queueRead = readHouseQueue(store).then(() => {
      store.queueRead = null;
    });
  }
}
