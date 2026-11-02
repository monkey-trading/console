/** The connected account's reads: eligibility, its withdrawal queue and history, and its state. */

import { carryAccrued } from "../engine/claim-standing";
import { EngineError } from "../engine/client";
import { UntrustedError } from "../engine/trust";
import { decodeAccount } from "../models";
import { NOT_CREDITED_MS, uncreditedKey } from "./quiet-reads";
import { decideSetup } from "./setup";
import type { ConsoleStore } from "./store";

/**
 * Reads the connected account's state into the store; a never-credited account is an empty one.
 * The wallet may change while the reads run; an answer for another account is dropped. A failure
 * is reported on the store and never thrown: it says nothing about the markets and house figures
 * the same refresh read, so it must not reach that read's error handling.
 * A node across the network answers 404 for the account and its entitlement until the account is
 * credited: both are read again at most every `NOT_CREDITED_MS`, and at once on an event for the
 * account (`QuietReads`). A credited account's reads are never held back.
 */
export async function loadAccount(store: ConsoleStore, withHistory: boolean): Promise<void> {
  const wallet = store.getSnapshot().wallet;
  if (!wallet) return;
  const { client } = store.deps;
  const quiet = client.signatures === "none" ? null : store.quiet; // the mock runs in this page: nothing to spare
  const mark = store.quiet.mark();
  const keyAtRead = store.sessionKey;
  const key = uncreditedKey(wallet.address);
  try {
    const held = quiet?.resting(key) === true;
    const [eligibility, queue, entitlement] = await Promise.all([
      client.eligibility(wallet.address), client.withdrawalQueue(wallet.address), held ? null : client.emissions(wallet.address),
    ]);
    let account = null;
    if (!held) {
      try {
        account = decodeAccount(await client.account(wallet.address));
      } catch (error) {
        if (!(error instanceof EngineError && error.status === 404)) throw error;
        quiet?.rest(key, NOT_CREDITED_MS, mark);
      }
    }
    if (store.getSnapshot().wallet?.address !== wallet.address) return;
    store.patch({ eligibility: eligibility.class, queue: queue.queue, accountRead: true, account, entitlement: entitlement === null ? null : carryAccrued(store.getSnapshot().entitlement, entitlement) });
    decideSetup(store, keyAtRead);
    if (withHistory || store.getSnapshot().history.length === 0) {
      const history = (await client.history(wallet.address, { limit: 100 })).events;
      if (store.getSnapshot().wallet?.address === wallet.address) store.patch({ history });
    }
    store.lastAccountError = null;
  } catch (error) {
    // Lost trust is reported once by the attestation check itself; the account read that waited on the same check stays silent.
    if (error instanceof UntrustedError) return;
    const message = error instanceof Error ? error.message : "The node did not answer.";
    if (!store.noteAccess(error) && message !== store.lastAccountError) store.toast("error", message);
    store.lastAccountError = message;
  }
}
