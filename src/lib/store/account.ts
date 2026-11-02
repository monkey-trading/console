/** The connected account's reads: eligibility, its withdrawal queue and history, and its state. */

import { carryAccrued } from "../engine/claim-standing";
import { EngineError } from "../engine/client";
import { UntrustedError } from "../engine/trust";
import { decodeAccount } from "../models";
import { emptyHistoryKey, NOT_CREDITED_MS, uncreditedKey, UNTIL_EVENT } from "./quiet-reads";
import { decideSetup } from "./setup";
import type { ConsoleStore } from "./store";

/**
 * Reads the connected account's state into the store; a never-credited account is an empty one.
 * The wallet may change while the reads run; an answer for another account is dropped. A failure
 * is put on the `accountRead` surface and never thrown: it says nothing about the markets and house figures
 * the same refresh read, so it must not reach that read's error handling.
 * A node across the network answers 404 for the account and its entitlement until the account is
 * credited: the account, its entitlement, eligibility and withdrawal queue are then read again at most
 * every `NOT_CREDITED_MS`, and at once on an event for the account (`QuietReads`); an eligibility
 * change reaches the console as the `eligibility_attested` event for the account, which is one. The
 * history of an account that has none is not read again until an event for the account. A credited
 * account's reads other than that empty history are never held back.
 */
export async function loadAccount(store: ConsoleStore, withHistory: boolean): Promise<void> {
  const wallet = store.getSnapshot().wallet;
  if (!wallet) return;
  const { client } = store.deps;
  const quiet = client.signatures === "none" ? null : store.quiet; // the mock runs in this page: nothing to spare
  const mark = store.quiet.mark();
  const keyAtRead = store.sessionKey;
  const key = uncreditedKey(wallet.address);
  const emptyHistory = emptyHistoryKey(wallet.address);
  try {
    // A read asked for with history follows an event, an action or a return of the feed: it reads everything. Otherwise what is held is the last read's, and nothing in it changes without an event.
    if (!withHistory && quiet?.resting(key) === true) return;
    const [eligibility, queue, entitlement] = await Promise.all([
      client.eligibility(wallet.address), client.withdrawalQueue(wallet.address), client.emissions(wallet.address),
    ]);
    let account = null;
    try {
      account = decodeAccount(await client.account(wallet.address));
    } catch (error) {
      if (!(error instanceof EngineError && error.status === 404)) throw error;
      quiet?.rest(key, NOT_CREDITED_MS, mark);
    }
    if (store.getSnapshot().wallet?.address !== wallet.address) return;
    store.patch({ eligibility: eligibility.class, queue: queue.queue, accountRead: true, account, entitlement: entitlement === null ? null : carryAccrued(store.getSnapshot().entitlement, entitlement) });
    decideSetup(store, keyAtRead);
    if (withHistory || (store.getSnapshot().history.length === 0 && quiet?.resting(emptyHistory) !== true)) {
      const history = (await client.history(wallet.address, { limit: 100 })).events;
      if (store.getSnapshot().wallet?.address === wallet.address) {
        store.patch({ history });
        if (history.length === 0) quiet?.rest(emptyHistory, UNTIL_EVENT, mark);
      }
    }
    store.clearNotice("accountRead");
  } catch (error) {
    // Lost trust is reported once by the attestation check itself; the account read that waited on the same check stays silent.
    if (error instanceof UntrustedError || store.noteAccess(error)) return;
    // Said where the account's figures would be; the next read, on the stream's next event, tries again. A failure that repeats keeps the one message.
    const message = `Your account could not be read: ${(error instanceof Error ? error.message : "the node did not answer").replace(/\.$/, "")}. The console tries again by itself.`;
    if (store.getSnapshot().notices.accountRead?.text !== message) store.notify("accountRead", message);
  }
}
