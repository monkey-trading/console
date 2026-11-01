/** The connected account's reads: eligibility, its withdrawal queue and history, and its state. */

import { EngineError } from "../engine/client";
import { decodeAccount } from "../models";
import type { ConsoleStore } from "./store";

/**
 * Reads the connected account's state into the store; a never-credited account is an empty one.
 * The wallet may change while the reads run; an answer for another account is dropped.
 */
export async function loadAccount(store: ConsoleStore, withHistory: boolean): Promise<void> {
  const wallet = store.getSnapshot().wallet;
  if (!wallet) return;
  const { client } = store.deps;
  const [eligibility, queue] = await Promise.all([client.eligibility(wallet.address), client.withdrawalQueue(wallet.address)]);
  let account = null;
  try {
    account = decodeAccount(await client.account(wallet.address));
  } catch (error) {
    if (!(error instanceof EngineError && error.status === 404)) throw error;
  }
  if (store.getSnapshot().wallet?.address !== wallet.address) return;
  store.patch({ eligibility: eligibility.class, queue: queue.queue, account });
  if (withHistory || store.getSnapshot().history.length === 0) {
    const history = (await client.history(wallet.address, { limit: 100 })).events;
    if (store.getSnapshot().wallet?.address === wallet.address) store.patch({ history });
  }
}
