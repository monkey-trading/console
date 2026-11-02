/**
 * Moving the session to another node: a fresh store over a fresh client, around the same wallet,
 * session key and setup state, since the connection has not ended. Nothing read from the old node
 * exists in the new store, and work the old store has in flight lands in a store no screen reads and
 * finds its wallet gone, so it sends nothing. A session key survives the move because it is registered
 * in the engine's state, which an elected successor takes with the log; a node that no longer holds it
 * refuses it, and the session-signed path then disconnects the wallet, so reconnecting brings setup
 * back at the key's step.
 */

import type { OperatorFollower } from "../engine/operator-follow";
import { connectWallet } from "./actions";
import { installKey } from "./session";
import type { ConsoleStore } from "./store";

/** What the console tells the user once the screens have remounted on the new store, so the log that announces it exists first. */
export const moveNotice = (host: string): string => `The console connected to ${host}, the node the chain names, and is verifying its attestation.`;

/** Hands `old`'s wallet, key and setup state to `next`; the stored entries need no change, since they name the account, chain and vault and no node. */
export async function moveToNode(old: ConsoleStore, next: ConsoleStore): Promise<void> {
  const wallet = old.liveWallet;
  const key = old.sessionKey;
  const { sessionExpiresAt, setup } = old.getSnapshot();
  old.movedAway = true;
  old.liveWallet = null;
  old.sessionKey = null;
  old.sessionLogin = null;
  if (wallet === null) return;
  // Set first, so the connect below keeps the key rather than clearing another wallet's.
  next.liveWallet = wallet;
  // Before the connect's first account read, which would otherwise decide the popup afresh over a dismissal.
  next.patch({ setup });
  if (key !== null && sessionExpiresAt > 0) installKey(next, key, sessionExpiresAt);
  await connectWallet(next, wallet.topic !== undefined ? "walletconnect" : "injected", true, wallet);
}

/** Has `follower` read the chain when this store's wallet changes, and hear this store's client. Returns what stops that. */
export function followNode(store: ConsoleStore, follower: OperatorFollower): () => void {
  let wallet = store.liveWallet;
  const stopClient = follower.watch(store.deps.client);
  const stopStore = store.subscribe(() => {
    if (store.liveWallet === wallet) return;
    wallet = store.liveWallet;
    void follower.check();
  });
  return () => {
    stopClient();
    stopStore();
  };
}

/** Asks the wallet back onto the deployment's chain, judges the node again and reads the chain again: what a wallet that wandered off, then came back, needs before anything is signed. */
export async function recheckNode(store: ConsoleStore, follower: Pick<OperatorFollower, "check"> | null): Promise<void> {
  try {
    await store.liveWallet?.ensureChain?.();
  } catch (error) {
    store.toast("error", error instanceof Error ? error.message : "The wallet stayed on another chain.");
    return;
  }
  await store.deps.client.verify();
  await follower?.check();
}
