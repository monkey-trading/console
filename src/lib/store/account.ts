/** The connected account's reads: eligibility, its withdrawal queue and history, and its state. */

import { EngineError } from "../engine/client";
import { UntrustedError } from "../engine/trust";
import { decodeAccount } from "../models";
import type { ConsoleStore } from "./store";

/**
 * Reads the connected account's state into the store; a never-credited account is an empty one.
 * The wallet may change while the reads run; an answer for another account is dropped. A failure
 * is reported on the store and never thrown: it says nothing about the markets and house figures
 * the same refresh read, so it must not reach that read's error handling.
 */
export async function loadAccount(store: ConsoleStore, withHistory: boolean): Promise<void> {
  const wallet = store.getSnapshot().wallet;
  if (!wallet) return;
  const { client } = store.deps;
  try {
    const [eligibility, queue, entitlement] = await Promise.all([client.eligibility(wallet.address), client.withdrawalQueue(wallet.address), client.emissions(wallet.address)]);
    let account = null;
    try {
      account = decodeAccount(await client.account(wallet.address));
    } catch (error) {
      if (!(error instanceof EngineError && error.status === 404)) throw error;
    }
    if (store.getSnapshot().wallet?.address !== wallet.address) return;
    store.patch({ eligibility: eligibility.class, queue: queue.queue, accountQueueRead: true, account, entitlement });
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
